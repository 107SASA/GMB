import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import Lead, { type ILead } from '@/models/Lead';
import OrchestrationConfig from '@/models/OrchestrationConfig';
import ScheduledAction from '@/models/ScheduledAction';
import { sendOutboundMessage } from '@/services/whatsapp/send';
import { logLeadEvent } from '@/services/leadEvents';

const DEFAULT_COOLDOWN_HOURS = 4;

/**
 * Effective proactive-message cooldown, in hours. Priority: env var (an
 * ops-level override with no DB write needed) > OrchestrationConfig doc >
 * hardcoded default. Task requirement: "read from an env var or a config
 * doc, don't hardcode only in code" — this reads both, env var winning.
 */
export async function getCooldownHours(): Promise<number> {
  const fromEnv = process.env.ORCHESTRATOR_COOLDOWN_HOURS;
  if (fromEnv !== undefined) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  await dbConnect();
  const config = await OrchestrationConfig.findOne({ key: 'default' }).select('cooldownHours').lean() as any;
  if (typeof config?.cooldownHours === 'number' && config.cooldownHours >= 0) return config.cooldownHours;
  return DEFAULT_COOLDOWN_HOURS;
}

/**
 * Stable (not random-per-call) percentage bucket for a lead id — the same
 * lead always lands in the same bucket at a fixed percentage, so it can't
 * flicker in/out of the cohort between messages. MD5 is fine here; this is
 * a rollout bucket, not a security boundary.
 */
function stablePercentBucket(leadId: string): number {
  const hash = crypto.createHash('md5').update(leadId).digest('hex');
  const n = parseInt(hash.slice(0, 8), 16);
  return n % 100; // 0-99
}

/**
 * Whether a lead is in the LEAD_ENGINE_V2 rollout cohort: on the explicit
 * allowlist (always wins, regardless of percentage — this is the mechanism
 * for testing "a handful of real leads" the task asks for), OR its stable
 * percent-bucket falls under the configured rolloutPercentage. Both an
 * empty allowlist and 0% is the safe-by-default starting state — no lead is
 * in cohort until an operator explicitly adds one or raises the percentage.
 * See OrchestrationConfig.ts's own doc comment for how to edit these today.
 */
export async function isLeadInCohort(leadId: string): Promise<boolean> {
  await dbConnect();
  const config = await OrchestrationConfig.findOne({ key: 'default' })
    .select('leadIdAllowlist rolloutPercentage')
    .lean() as any;
  if (!config) return false;

  const allowlist: string[] = (config.leadIdAllowlist || []).map((id: any) => String(id));
  if (allowlist.includes(String(leadId))) return true;

  const pct = typeof config.rolloutPercentage === 'number' ? config.rolloutPercentage : 0;
  if (pct <= 0) return false;
  return stablePercentBucket(String(leadId)) < pct;
}

export interface RequestOutboundMessageInput {
  leadId: string;
  /** Which agent is asking to send — must match Lead.currentAgent. */
  agent: 'SALES' | 'DEMO' | 'IN_HOUSE' | 'HUMAN';
  /** Builds the actual message text — only called once every check passes, so a rejected request never pays for composing a message (e.g. an LLM call) it won't send. */
  messageBuilder: () => Promise<string> | string;
  /** True for a direct reply to something the lead just said; false for an agent-initiated/proactive message (drip, re-engagement) — only proactive sends are subject to the cooldown. */
  isReply: boolean;
  /** Optional — when given, guards against double-sending the same logical action (see ScheduledAction.idempotencyKey). */
  idempotencyKey?: string;
}

export type OrchestratorOutcome =
  | { decision: 'FALL_BACK_TO_LEGACY' } // LEAD_ENGINE_V2 off, or lead not in cohort — caller should use sendOutboundMessage() directly, unchanged
  | { decision: 'SENT'; sid?: string }
  | { decision: 'REJECTED'; reason: string };

/**
 * The Phase 5 gate in front of every WhatsApp send this codebase's new
 * ownership/NBA engine is aware of. Does NOT replace sendOutboundMessage()
 * — it decides WHETHER to call it, then calls it unchanged (Step 5/7 of the
 * task: reuse the existing 24h-window/template-fallback logic and
 * MessageQueue logging already inside send.ts, never reimplement them
 * here).
 *
 * Returns `{ decision: 'FALL_BACK_TO_LEGACY' }` whenever LEAD_ENGINE_V2 is
 * off globally OR this specific lead isn't in the rollout cohort — the
 * caller is expected to fall back to calling sendOutboundMessage() directly
 * itself in that case, so a lead outside the cohort behaves byte-for-byte
 * like today. This function NEVER sends on behalf of a caller who then also
 * sends themselves — see runSalesFollowUpDrip's call site for the exact
 * fallback pattern this contract expects.
 */
export async function requestOutboundMessage(
  input: RequestOutboundMessageInput
): Promise<OrchestratorOutcome> {
  await dbConnect();

  // --- Step 1: flag + cohort gate -------------------------------------------
  if (process.env.LEAD_ENGINE_V2 !== 'true') {
    return { decision: 'FALL_BACK_TO_LEGACY' };
  }
  const inCohort = await isLeadInCohort(input.leadId);
  if (!inCohort) {
    return { decision: 'FALL_BACK_TO_LEGACY' };
  }

  const lead = await Lead.findById(input.leadId);
  if (!lead) {
    // No Lead to gate against at all — nothing this orchestrator can safely
    // reason about. Falls back rather than rejecting outright, matching the
    // "when the flag/cohort doesn't apply, behave like today" contract.
    return { decision: 'FALL_BACK_TO_LEGACY' };
  }

  // --- Step 2: ownership check -----------------------------------------------
  const currentAgent = lead.currentAgent || 'NONE';
  if (currentAgent !== input.agent) {
    await reject(lead, input, 'ownership-mismatch', { expectedAgent: input.agent, actualAgent: currentAgent });
    return { decision: 'REJECTED', reason: 'ownership-mismatch' };
  }

  // --- Step 3: hard stops -----------------------------------------------------
  if (lead.nurtureStatus === 'STOPPED' || lead.nurtureStatus === 'OPTED_OUT') {
    await reject(lead, input, 'nurture-stopped', { nurtureStatus: lead.nurtureStatus });
    return { decision: 'REJECTED', reason: 'nurture-stopped' };
  }
  if (lead.currentStage === 'DO_NOT_CONTACT') {
    await reject(lead, input, 'do-not-contact', {});
    return { decision: 'REJECTED', reason: 'do-not-contact' };
  }

  // --- Step 4: cooldown for proactive (non-reply) sends -----------------------
  // Signal: Lead.lastProactiveMessageAt, set below on every successful
  // non-reply send by THIS orchestrator (any caller, any agent) — not
  // scoped to ScheduledAction rows, so a proactive send that goes straight
  // through the orchestrator (not scheduled first) still counts.
  if (!input.isReply) {
    const cooldownHours = await getCooldownHours();
    if (cooldownHours > 0 && lead.lastProactiveMessageAt) {
      const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
      if (lead.lastProactiveMessageAt >= cutoff) {
        await reject(lead, input, 'cooldown-active', { cooldownHours, lastProactiveMessageAt: lead.lastProactiveMessageAt });
        return { decision: 'REJECTED', reason: 'cooldown-active' };
      }
    }
  }

  // --- Step 6: idempotency -----------------------------------------------------
  if (input.idempotencyKey) {
    const alreadyExecuted = await ScheduledAction.findOne({
      idempotencyKey: input.idempotencyKey,
      status: 'EXECUTED',
    }).lean();
    if (alreadyExecuted) {
      await reject(lead, input, 'already-executed', { idempotencyKey: input.idempotencyKey });
      return { decision: 'REJECTED', reason: 'already-executed' };
    }
  }

  // --- Step 5 & 7: send via the EXISTING sender (24h-window/template logic --
  // and MessageQueue logging all already live inside send.ts — not
  // reimplemented here) --------------------------------------------------------
  const body = await input.messageBuilder();
  const result = await sendOutboundMessage(lead.phone, body, String(lead._id), lead.businessId?.toString());

  if (result.success) {
    if (!input.isReply) {
      lead.lastProactiveMessageAt = new Date();
      await lead.save();
    }
    logLeadEvent(
      'MESSAGE_SENT',
      {
        channel: 'whatsapp',
        agent: input.agent,
        isReply: input.isReply,
        sid: result.sid,
        // Every send through this orchestrator is a LEAD_ENGINE_V2 cohort
        // send by definition (Step 1 above returns FALL_BACK_TO_LEGACY
        // otherwise) — tag it so V2 traffic is trivially separable from
        // legacy nurture and live agent replies when auditing outbound.
        source: 'V2_NURTURE',
      },
      `${input.agent.toLowerCase()}-agent`,
      { leadId: lead._id, phone: lead.phone }
    );
    return { decision: 'SENT', sid: result.sid };
  }

  await reject(lead, input, 'send-failed', { error: result.error });
  return { decision: 'REJECTED', reason: 'send-failed' };
}

async function reject(
  lead: ILead,
  input: RequestOutboundMessageInput,
  reason: string,
  extra: Record<string, unknown>
): Promise<void> {
  logLeadEvent(
    'NURTURE_ACTION_SKIPPED',
    { agent: input.agent, isReply: input.isReply, reason, ...extra },
    `${input.agent.toLowerCase()}-agent`,
    { leadId: lead._id, phone: lead.phone }
  );
}
