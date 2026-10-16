import { randomUUID } from 'node:crypto';
import type { Model } from 'mongoose';
import type { ReminderPolicy } from './billingPolicy.ts';

/**
 * WhatsApp payment-recovery reminders — the schedule, atomic step claims, the
 * send/retry/stop rules. No `@/` imports; the episode model, the clock, the
 * sender and the account lookups are passed in (services/billing/
 * recoveryRemindersService.ts wires the real ones), so tests drive it with a
 * fake clock and a fake WhatsApp sender against a real MongoDB.
 *
 * Guarantees:
 *  - Day 0 is the failure timestamp, frozen when the episode opens.
 *  - A step is CLAIMED atomically (one findOneAndUpdate) before sending, so
 *    any number of concurrent or repeated job runs send it at most once. No
 *    database lock is held while waiting for Twilio.
 *  - Only explicit, retry-safe provider rejections (rate limits) are retried.
 *    A timeout/unknown outcome is 'ambiguous' and never re-sent; a claim left
 *    behind by a crashed worker becomes 'ambiguous' too — so a retry can never
 *    produce a second message. Both are flagged for review.
 *  - Reminders never touch payment status or access.
 */

export const STALE_CLAIM_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlannedStep {
  key: string;
  offsetDays: number;
  final: boolean;
  dueAt: Date;
  nextAttemptAt: Date;
  status: 'pending';
  attempts: 0;
}

/** The schedule frozen at Day 0: the policy's steps, capped at maxReminders. */
export function planReminderSteps(failedAt: Date, policy: Pick<ReminderPolicy, 'steps' | 'maxReminders'>): PlannedStep[] {
  const steps = [...policy.steps].sort((a, b) => a.offsetDays - b.offsetDays).slice(0, policy.maxReminders);
  return steps.map((s, i) => {
    const dueAt = new Date(failedAt.getTime() + s.offsetDays * DAY_MS);
    return { key: `d${s.offsetDays}`, offsetDays: s.offsetDays, final: i === steps.length - 1, dueAt, nextAttemptAt: dueAt, status: 'pending', attempts: 0 };
  });
}

function localHour(now: Date, timezone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: get('hour'), minute: get('minute') };
}

export function isWithinSendingHours(now: Date, hours: { start: number; end: number }, timezone: string): boolean {
  const { hour } = localHour(now, timezone);
  return hour >= hours.start && hour < hours.end;
}

/** The next instant the sending window opens (minute resolution). */
export function nextSendingWindow(now: Date, hours: { start: number; end: number }, timezone: string): Date {
  if (isWithinSendingHours(now, hours, timezone)) return now;
  const { hour, minute } = localHour(now, timezone);
  let minutesUntil = (hours.start - hour) * 60 - minute;
  if (minutesUntil <= 0) minutesUntil += 24 * 60;
  const t = new Date(now.getTime() + minutesUntil * 60_000);
  t.setUTCSeconds(0, 0);
  return t;
}

export interface SendResult {
  success: boolean;
  sid?: string;
  error?: string;
  errorCode?: string;
}

export type SendOutcome = 'sent' | 'retry' | 'failed' | 'ambiguous';

/** Twilio rejections that are safe to retry: the message was definitely not accepted. */
const RETRYABLE_CODES = new Set(['20429', '429', '30001']);

export function classifySendResult(r: SendResult): SendOutcome {
  if (r.success && r.sid) return 'sent';
  if (r.success) return 'ambiguous'; // accepted but no id to track — never resend
  if (r.errorCode && RETRYABLE_CODES.has(r.errorCode)) return 'retry';
  if (r.errorCode) return 'failed'; // an explicit rejection (bad number, template, opt-out…)
  if (/timeout|timed out|ECONN|socket|network|ETIMEDOUT|EAI_AGAIN/i.test(r.error ?? '')) return 'ambiguous';
  return 'failed'; // configuration problems (no credentials, invalid recipient) — retrying won't help
}

/** Only the newest due step is sent; older still-due steps are skipped (no catch-up burst). */
export function stepsToSkip<T extends { key: string; status: string; nextAttemptAt: Date | string }>(steps: T[], now: Date): string[] {
  const due = steps.filter((s) => (s.status === 'pending' || s.status === 'retry') && new Date(s.nextAttemptAt).getTime() <= now.getTime());
  return due.slice(0, -1).map((s) => s.key);
}

// ── store operations ────────────────────────────────────────────────────────

type EpisodeModel = Model<any>;

/** Opens the episode for a new payment failure. Idempotent: one open episode per workspace. */
export async function openEpisode(
  model: EpisodeModel,
  input: { businessId: unknown; userId: unknown; razorpaySubscriptionId?: string | null; failureKind?: string; failedAt: Date; policy: Pick<ReminderPolicy, 'steps' | 'maxReminders'> }
): Promise<{ episode: any; created: boolean }> {
  try {
    const episode = await model.create({
      businessId: input.businessId,
      userId: input.userId,
      razorpaySubscriptionId: input.razorpaySubscriptionId ?? undefined,
      failureKind: input.failureKind,
      failedAt: input.failedAt,
      status: 'open',
      steps: planReminderSteps(input.failedAt, input.policy),
    });
    return { episode: episode.toObject(), created: true };
  } catch (err: any) {
    if (err?.code === 11000) {
      return { episode: await model.findOne({ businessId: input.businessId, status: 'open' }).lean(), created: false };
    }
    throw err;
  }
}

/** Closes a workspace's open episode; its unsent steps become 'stopped'. */
export async function closeEpisodes(
  model: EpisodeModel,
  input: { businessId: unknown; status: 'resolved' | 'stopped'; reason: string; now: Date }
): Promise<number> {
  const open = await model.find({ businessId: input.businessId, status: 'open' }).select('_id').lean<any[]>();
  for (const ep of open) await closeEpisode(model, ep._id, input.status, input.reason, input.now);
  return open.length;
}

async function closeEpisode(model: EpisodeModel, id: unknown, status: 'resolved' | 'stopped', reason: string, now: Date) {
  await model.updateOne(
    { _id: id, status: 'open' },
    { $set: { status, stopReason: reason, closedAt: now, 'steps.$[s].status': 'stopped' } },
    { arrayFilters: [{ 's.status': { $in: ['pending', 'retry'] } }] }
  );
}

/** Atomically claims the earliest due step of one episode. Null = nothing to send (or someone else took it). */
export async function claimDueStep(model: EpisodeModel, episodeId: unknown, now: Date): Promise<{ episode: any; step: any; token: string } | null> {
  const token = randomUUID();
  const episode = await model
    .findOneAndUpdate(
      { _id: episodeId, status: 'open', steps: { $elemMatch: { status: { $in: ['pending', 'retry'] }, nextAttemptAt: { $lte: now } } } },
      { $set: { 'steps.$.status': 'claimed', 'steps.$.claimToken': token, 'steps.$.claimedAt': now }, $inc: { 'steps.$.attempts': 1 } },
      { returnDocument: 'after' }
    )
    .lean<any>();
  if (!episode) return null;
  const step = episode.steps.find((s: any) => s.claimToken === token);
  return step ? { episode, step, token } : null;
}

async function setStep(model: EpisodeModel, episodeId: unknown, token: string, set: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const $set = Object.fromEntries(Object.entries(set).map(([k, v]) => [`steps.$[s].${k}`, v]));
  await model.updateOne({ _id: episodeId }, { $set: { ...$set, ...((extra as any).$set ?? {}) }, ...(extra.$inc ? { $inc: extra.$inc } : {}) }, { arrayFilters: [{ 's.claimToken': token }] });
}

/** Twilio status callback → delivery status of the step that sent this message. */
export async function recordDelivery(model: EpisodeModel, providerMessageId: string, deliveryStatus: string, now: Date): Promise<boolean> {
  const res = await model.updateOne(
    { 'steps.providerMessageId': providerMessageId },
    { $set: { 'steps.$[s].deliveryStatus': deliveryStatus, 'steps.$[s].deliveryUpdatedAt': now } },
    { arrayFilters: [{ 's.providerMessageId': providerMessageId }] }
  );
  return res.modifiedCount > 0;
}

// ── the runner ──────────────────────────────────────────────────────────────

export interface ReminderContext {
  /** Close the episode instead of sending (payment recovered, cancelled, phone/opt-out…). */
  close?: { status: 'resolved' | 'stopped'; reason: string };
  phone?: string;
  variables?: Record<string, string>;
}

export interface RunnerDeps {
  Episode: EpisodeModel;
  now: () => Date;
  policy: ReminderPolicy;
  loadContext: (episode: any) => Promise<ReminderContext>;
  send: (phone: string, contentSid: string, variables: Record<string, string>) => Promise<SendResult>;
}

export interface RunSummary {
  sent: number;
  retried: number;
  failed: number;
  ambiguous: number;
  skipped: number;
  deferred: number;
  closed: number;
  staleClaims: number;
}

export async function runRecoveryReminders(deps: RunnerDeps, opts: { episodeId?: unknown; limit?: number } = {}): Promise<RunSummary> {
  const { Episode, policy } = deps;
  const now = deps.now();
  const summary: RunSummary = { sent: 0, retried: 0, failed: 0, ambiguous: 0, skipped: 0, deferred: 0, closed: 0, staleClaims: 0 };

  // A claim a crashed worker left behind: Twilio may or may not have the
  // message — never resend; flag it.
  const stale = await Episode.updateMany(
    { status: 'open', steps: { $elemMatch: { status: 'claimed', claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } } } },
    {
      $set: { 'steps.$[s].status': 'ambiguous', 'steps.$[s].lastError': 'worker stopped mid-send — not resent', needsReview: true },
    },
    { arrayFilters: [{ 's.status': 'claimed', 's.claimedAt': { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } }] }
  );
  summary.staleClaims = stale.modifiedCount;

  const filter: Record<string, unknown> = {
    status: 'open',
    steps: { $elemMatch: { status: { $in: ['pending', 'retry'] }, nextAttemptAt: { $lte: now } } },
  };
  if (opts.episodeId) filter._id = opts.episodeId;
  const episodes = await Episode.find(filter).limit(opts.limit ?? 100).lean<any[]>();

  for (const ep of episodes) {
    if (!policy.enabled) {
      await closeEpisode(Episode, ep._id, 'stopped', 'reminders_disabled', now);
      summary.closed++;
      continue;
    }
    const ctx = await deps.loadContext(ep);
    if (ctx.close) {
      await closeEpisode(Episode, ep._id, ctx.close.status, ctx.close.reason, now);
      summary.closed++;
      continue;
    }
    if ((ep.remindersSent ?? 0) >= policy.maxReminders) {
      await closeEpisode(Episode, ep._id, 'stopped', 'max_reminders', now);
      summary.closed++;
      continue;
    }

    // Only the newest due step goes out (a long outage never causes a burst).
    const skip = stepsToSkip(ep.steps, now);
    if (skip.length) {
      await Episode.updateOne(
        { _id: ep._id },
        { $set: { 'steps.$[s].status': 'skipped', 'steps.$[s].lastError': 'superseded by a later reminder' } },
        { arrayFilters: [{ 's.key': { $in: skip }, 's.status': { $in: ['pending', 'retry'] } }] }
      );
      summary.skipped += skip.length;
    }

    if (!isWithinSendingHours(now, policy.sendingHours, policy.timezone)) {
      const at = nextSendingWindow(now, policy.sendingHours, policy.timezone);
      await Episode.updateOne(
        { _id: ep._id },
        { $set: { 'steps.$[s].nextAttemptAt': at } },
        { arrayFilters: [{ 's.status': { $in: ['pending', 'retry'] }, 's.nextAttemptAt': { $lte: now } }] }
      );
      summary.deferred++;
      continue;
    }

    const claim = await claimDueStep(Episode, ep._id, now);
    if (!claim) continue; // another run took it
    const template = claim.step.final && policy.finalTemplate ? policy.finalTemplate : policy.template;
    if (!ctx.phone || !ctx.variables) {
      await setStep(Episode, ep._id, claim.token, { status: 'failed', lastError: 'no eligible phone' });
      summary.failed++;
      continue;
    }

    // Network call — no DB lock is held here; the claim protects the step.
    let result: SendResult;
    try {
      result = await deps.send(ctx.phone, template.contentSid, ctx.variables);
    } catch (err: any) {
      result = { success: false, error: String(err?.message ?? err) };
    }
    const outcome = classifySendResult(result);
    const at = deps.now();
    if (outcome === 'sent') {
      await setStep(Episode, ep._id, claim.token, { status: 'sent', sentAt: at, providerMessageId: result.sid, templateSid: template.contentSid }, { $inc: { remindersSent: 1 } });
      summary.sent++;
    } else if (outcome === 'retry' && claim.step.attempts < policy.retry.maxAttempts) {
      const backoff = policy.retry.backoffMinutes * 60_000 * 2 ** (claim.step.attempts - 1);
      await setStep(Episode, ep._id, claim.token, { status: 'retry', nextAttemptAt: new Date(at.getTime() + backoff), lastError: result.error ?? 'rate limited', lastErrorCode: result.errorCode });
      summary.retried++;
    } else if (outcome === 'ambiguous') {
      await setStep(Episode, ep._id, claim.token, { status: 'ambiguous', lastError: result.error ?? 'unknown outcome — not resent', lastErrorCode: result.errorCode }, { $set: { needsReview: true } });
      summary.ambiguous++;
    } else {
      await setStep(Episode, ep._id, claim.token, { status: 'failed', lastError: result.error ?? 'send failed', lastErrorCode: result.errorCode });
      summary.failed++;
    }
  }
  return summary;
}
