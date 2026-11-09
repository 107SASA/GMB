/**
 * Review campaigns send at the workspace's daily WhatsApp pace.
 *
 * Before (Nov 2026): launching checked the daily limit once per customer at
 * the same moment — every check saw "0 sent today" — so 500 uploaded
 * customers got 500 WhatsApps at once, and the reminders that then hit the
 * limit were dropped for good.
 *
 * Now launching queues the customers (CampaignQueueItem) and, every day, the
 * dispatcher starts only what the day allows:
 *
 *   new requests today = daily limit − already sent today
 *                        − first messages started today but not sent yet
 *                        − reminders due today (reserved first)
 *
 * Example, limit 10, 200 customers: day 1 → 10 new; day 3 (their reminders
 * are due) → 10 reminders, 0 new; day 4 → 10 new … A reminder that still
 * meets a full day waits for the next one (processReviewCampaign).
 *
 * The day is the UTC day, the same bucket the WhatsApp counter uses
 * (lib/featureGating.ts).
 */
import dbConnect from '@/lib/mongodb';
import mongoose from 'mongoose';

const DAY_MS = 24 * 3_600_000;
/** A reminder deferred by a full day is still reserved for up to this many days. */
export const REMINDER_DEFER_DAYS = 3;
/** A queued customer asked another way within this many days is skipped. */
export const ASKED_RECENTLY_DAYS = 30;
/**
 * Slots campaigns never use, so the owner can always send a request by hand
 * (web, app, quick-add) — only when the daily limit is at least 5.
 */
export const MANUAL_RESERVE_SLOTS = 2;
export function manualReserveFor(limit: number): number {
  return limit >= 5 ? MANUAL_RESERVE_SLOTS : 0;
}
/** "Unlimited" plans still start at most this many new requests a day. */
const UNLIMITED_DAILY_CAP = 100;

/** WhatsApp messages counted for this workspace on `now`'s UTC day (lib/featureGating.ts bucket). */
async function sentOn(businessId: string, now: Date): Promise<number> {
  const { default: SubscriptionUsage } = await import('@/models/SubscriptionUsage');
  const row: any = await SubscriptionUsage.findOne({ businessId, month: now.toISOString().slice(0, 10) }).select('whatsappMessagesUsed').lean();
  return row?.whatsappMessagesUsed ?? 0;
}

export function utcDayBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Pure — exported for tests. */
export function planDailyBudget(input: { limit: number; sentToday: number; startedNotSent: number; remindersDue: number }): number {
  const limit = input.limit < 0 ? UNLIMITED_DAILY_CAP : input.limit;
  return Math.max(0, limit - manualReserveFor(limit) - input.sentToday - input.startedNotSent - input.remindersDue);
}

/** New campaign requests on a day with no reminders (limit minus the manual reserve). */
export function campaignPerDay(limit: number): number {
  const l = limit < 0 ? UNLIMITED_DAILY_CAP : limit;
  return Math.max(0, l - manualReserveFor(l));
}

/** Days still needed for `waiting` customers at `perDay` new requests a day (rough, for the owner). */
export function daysToFinish(waiting: number, perDay: number): number | null {
  if (waiting <= 0) return 0;
  if (perDay <= 0) return null;
  return Math.ceil(waiting / perDay);
}

/**
 * Reminders that will want to send today for this workspace: first
 * reminders whose delay ends today (or ended up to REMINDER_DEFER_DAYS ago
 * and were pushed by a full day), and — when a second message of a
 * different template is possible — second reminders likewise.
 */
export async function remindersDueToday(businessId: string, now = new Date()): Promise<number> {
  await dbConnect();
  const [{ default: ReviewRequest }, { loadReviewFollowUpPolicy }, { WA_TEMPLATES }] = await Promise.all([
    import('@/models/ReviewRequest'),
    import('@/lib/reviewFollowUpPolicyStore'),
    import('@/lib/whatsappTemplates'),
  ]);
  const policy = await loadReviewFollowUpPolicy();
  if (!policy.enabled || policy.maximumFollowUps < 1) return 0;
  const { end } = utcDayBounds(now);
  const open = {
    businessId: new mongoose.Types.ObjectId(businessId),
    automationStatus: 'Active',
    status: { $in: ['Sent', 'Delivered', 'Read'] },
    ...(policy.stopOnClick ? { clicked: { $ne: true }, clickedAt: null } : {}),
  };
  const window = (delayDays: number) => ({
    $gte: new Date(end.getTime() - (delayDays + 1 + REMINDER_DEFER_DAYS) * DAY_MS),
    $lt: new Date(end.getTime() - delayDays * DAY_MS),
  });
  const first = await ReviewRequest.countDocuments({ ...open, followUpStage: 0, sentAt: window(policy.initialFollowUpDelayDays) });
  // With the utility template a customer gets the same approved text at most
  // twice — the second reminder never sends, so it reserves nothing.
  if (policy.maximumFollowUps < 2 || WA_TEMPLATES.reviewRequestUtility.trim()) return first;
  const second = await ReviewRequest.countDocuments({
    ...open,
    followUpStage: 1,
    messageHistory: { $elemMatch: { stage: 'reminder1', status: 'Sent', sentAt: window(policy.secondFollowUpDelayDays) } },
  });
  return first + second;
}

/** Queue customers for a campaign (once each; a relaunch adds only new ones). */
export async function enqueueCampaignCustomers(campaignId: string, businessId: string, customerIds: string[]): Promise<{ added: number }> {
  await dbConnect();
  const { default: CampaignQueueItem } = await import('@/models/CampaignQueueItem');
  if (!customerIds.length) return { added: 0 };
  const last: any = await CampaignQueueItem.findOne({ campaignId }).sort({ position: -1 }).select('position').lean();
  let position = (last?.position ?? -1) + 1;
  const now = new Date();
  const res = await CampaignQueueItem.bulkWrite(
    customerIds.map((customerId) => ({
      updateOne: {
        filter: { campaignId: new mongoose.Types.ObjectId(campaignId), customerId: new mongoose.Types.ObjectId(customerId) },
        update: { $setOnInsert: { businessId: new mongoose.Types.ObjectId(businessId), status: 'queued', position: position++, queuedAt: now } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return { added: res.upsertedCount || 0 };
}

export interface DispatchResult {
  limit: number;
  sentToday: number;
  remindersReserved: number;
  budget: number;
  dispatched: number;
  skipped: number;
}

/**
 * Start today's share of every ACTIVE campaign of one workspace (oldest
 * campaign first, upload order inside it). Safe to call repeatedly — what was
 * started today counts against the same day.
 */
export async function dispatchCampaignQueue(businessId: string, now = new Date(), deps: { send?: (events: any[]) => Promise<unknown> } = {}): Promise<DispatchResult> {
  await dbConnect();
  const [{ default: CampaignQueueItem }, { default: Campaign }, { default: Business }, { default: Customer }, { default: ReviewRequest }, { checkUsageLimit }, { evaluateReviewSendEligibility }] = await Promise.all([
    import('@/models/CampaignQueueItem'),
    import('@/models/Campaign'),
    import('@/models/Business'),
    import('@/models/Customer'),
    import('@/models/ReviewRequest'),
    import('@/lib/featureGating'),
    import('@/lib/reviewSendEligibility'),
  ]);
  const empty = { limit: 0, sentToday: 0, remindersReserved: 0, budget: 0, dispatched: 0, skipped: 0 };
  const business: any = await Business.findById(businessId).select('userId organizationId').lean();
  if (!business?.userId) return empty;

  const usage = await checkUsageLimit(String(business.userId), businessId, 'whatsappMessages', 0);
  const limit = typeof usage.limit === 'number' ? usage.limit : 0;
  const sentToday = await sentOn(businessId, now);
  const { start } = utcDayBounds(now);
  const startedNotSent = await CampaignQueueItem.countDocuments({ businessId, status: 'dispatched', dispatchedAt: { $gte: start } });
  const remindersReserved = await remindersDueToday(businessId, now);
  // Requests the owner sent by hand on a full day may use every slot; the
  // campaigns keep the manual reserve free.
  const fullBudget = Math.max(0, (limit < 0 ? UNLIMITED_DAILY_CAP : limit) - sentToday - startedNotSent - remindersReserved);
  const budget = planDailyBudget({ limit, sentToday, startedNotSent, remindersDue: remindersReserved });
  const result: DispatchResult = { limit, sentToday, remindersReserved, budget: fullBudget, dispatched: 0, skipped: 0 };
  if (fullBudget <= 0) return result;

  // The owner's "send tomorrow" list first, then campaigns oldest first.
  const campaigns: any[] = await Campaign.find({ businessId, status: 'ACTIVE' }).sort({ manualQueue: -1, startedAt: 1 }).select('_id manualQueue').lean();
  const events: any[] = [];
  for (const campaign of campaigns) {
    // Yesterday's hand-sent requests go first and may use any slot. Campaigns
    // fill what is left of `budget`, so today's manual reserve stays free.
    const room = () => campaign.manualQueue ? events.length < fullBudget : events.length < budget;
    while (room()) {
      const item: any = await CampaignQueueItem.findOneAndUpdate(
        { campaignId: campaign._id, status: 'queued' },
        { $set: { status: 'dispatched', dispatchedAt: now } },
        { sort: { position: 1 }, new: true },
      ).lean();
      if (!item) break;
      const customer: any = await Customer.findOne({ _id: item.customerId, businessId }).lean();
      // Asked another way meanwhile (sent by hand, or another campaign) —
      // never send the same person a second request.
      const askedRecently = customer && await ReviewRequest.exists({
        businessId,
        customerId: item.customerId,
        $or: [{ automationStatus: 'Active' }, { sentAt: { $gte: new Date(now.getTime() - ASKED_RECENTLY_DAYS * DAY_MS) } }],
      });
      const eligibility = !customer
        ? { allowed: false, code: 'CUSTOMER_MISSING', message: 'Customer was deleted.' }
        : askedRecently
          ? { allowed: false, code: 'ALREADY_ASKED', message: `Already asked for a review in the last ${ASKED_RECENTLY_DAYS} days.` }
          : await evaluateReviewSendEligibility({ source: 'campaign', businessId, userId: String(business.userId), customer, campaignId: String(campaign._id) });
      if (!eligibility.allowed) {
        await CampaignQueueItem.updateOne({ _id: item._id }, { $set: { status: 'skipped', reason: eligibility.message || eligibility.code } });
        result.skipped++;
        continue;
      }
      events.push({
        name: 'campaigns/review.request.start',
        data: { customerId: String(item.customerId), businessId, tenantId: String(business.organizationId), campaignId: String(campaign._id) },
      });
    }
    if (events.length >= fullBudget) break;
  }
  if (events.length) {
    const send = deps.send ?? (async (e: any[]) => (await import('@/services/inngest/client')).inngest.send(e));
    await send(events);
  }
  result.dispatched = events.length;
  return result;
}

/** Daily cron: every workspace with customers waiting in an active campaign. */
export async function dispatchAllCampaignQueues(now = new Date()): Promise<{ businesses: number; dispatched: number }> {
  await dbConnect();
  const [{ default: CampaignQueueItem }, { default: Campaign }] = await Promise.all([import('@/models/CampaignQueueItem'), import('@/models/Campaign')]);
  const active: any[] = await Campaign.find({ status: 'ACTIVE' }).select('_id').lean();
  if (!active.length) return { businesses: 0, dispatched: 0 };
  const businessIds: any[] = await CampaignQueueItem.distinct('businessId', { campaignId: { $in: active.map((c) => c._id) }, status: 'queued' });
  let dispatched = 0;
  for (const id of businessIds) {
    try {
      dispatched += (await dispatchCampaignQueue(String(id), now)).dispatched;
    } catch (err: any) {
      console.error(`[campaignQueue] dispatch failed for ${id}:`, err?.message);
    }
  }
  return { businesses: businessIds.length, dispatched };
}

/** The first message of a queued customer went out (or could not). Called by processReviewCampaign. */
export async function markQueueItem(campaignId: string | undefined, customerId: string, outcome: { sent: boolean; reason?: string }): Promise<void> {
  if (!campaignId) return;
  await dbConnect();
  const { default: CampaignQueueItem } = await import('@/models/CampaignQueueItem');
  await CampaignQueueItem.updateOne(
    { campaignId, customerId, status: { $in: ['dispatched', 'queued'] } },
    { $set: outcome.sent ? { status: 'sent', sentAt: new Date() } : { status: 'failed', reason: (outcome.reason || 'Not sent').slice(0, 300) } },
  ).catch(() => {});
}

/** Cancelling a campaign drops everyone still waiting. */
export async function cancelQueuedCustomers(campaignId: string): Promise<number> {
  await dbConnect();
  const { default: CampaignQueueItem } = await import('@/models/CampaignQueueItem');
  const res = await CampaignQueueItem.updateMany({ campaignId, status: 'queued' }, { $set: { status: 'cancelled', reason: 'Campaign cancelled' } });
  return res.modifiedCount || 0;
}

export interface QueueSummary {
  waiting: number;
  started: number;
  sent: number;
  notSent: number;
  /** New requests a day at the current limit (reminders not counted). */
  perDay: number;
  daysLeft: number | null;
}

/** Progress per campaign, for the campaign list. */
export async function campaignQueueSummaries(campaignIds: string[], dailyLimit: number): Promise<Record<string, QueueSummary>> {
  await dbConnect();
  const { default: CampaignQueueItem } = await import('@/models/CampaignQueueItem');
  const out: Record<string, QueueSummary> = {};
  if (!campaignIds.length) return out;
  const rows: any[] = await CampaignQueueItem.aggregate([
    { $match: { campaignId: { $in: campaignIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
    { $group: { _id: { c: '$campaignId', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const perDay = campaignPerDay(dailyLimit);
  for (const id of campaignIds) out[id] = { waiting: 0, started: 0, sent: 0, notSent: 0, perDay, daysLeft: 0 };
  for (const r of rows) {
    const s = out[String(r._id.c)];
    if (!s) continue;
    if (r._id.s === 'queued') s.waiting += r.n;
    else if (r._id.s === 'dispatched') s.started += r.n;
    else if (r._id.s === 'sent') s.sent += r.n;
    else s.notSent += r.n;
  }
  for (const s of Object.values(out)) s.daysLeft = daysToFinish(s.waiting, perDay);
  return out;
}

export interface QueuedLaunch {
  queued: number;
  startedToday: number;
  waiting: number;
  perDay: number;
  daysLeft: number | null;
  remindersReservedToday: number;
  limit: number;
  message: string;
}

/**
 * Queue customers into an ACTIVE campaign and start today's share now —
 * shared by "Launch campaign" and "Send to all" after a bulk upload.
 */
export async function startQueuedCampaign(campaignId: string, businessId: string, customerIds: string[]): Promise<QueuedLaunch> {
  const { added } = await enqueueCampaignCustomers(campaignId, businessId, customerIds);
  const { default: Campaign } = await import('@/models/Campaign');
  if (added) await Campaign.updateOne({ _id: campaignId }, { $inc: { totalRequests: added } });
  const today = await dispatchCampaignQueue(businessId);
  const summary = (await campaignQueueSummaries([campaignId], today.limit))[campaignId];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const message = today.dispatched
    ? `${plural(today.dispatched, 'request')} going out today.${summary.waiting ? ` ${summary.waiting} more will send automatically, up to ${summary.perDay} a day${today.remindersReserved ? ' — reminders go first' : ''}.` : ''}`
    : summary.waiting
      ? `Today's ${today.limit}-message limit is already used${today.remindersReserved ? ' (reminders go first)' : ''}. ${plural(summary.waiting, 'customer')} will start sending from tomorrow, up to ${summary.perDay} a day.`
      : 'Nobody in this list can get a WhatsApp review request right now (no phone number, opted out, or already asked in this campaign).';
  return {
    queued: added,
    startedToday: today.dispatched,
    waiting: summary.waiting,
    perDay: summary.perDay,
    daysLeft: summary.daysLeft,
    remindersReservedToday: today.remindersReserved,
    limit: today.limit,
    message,
  };
}

/** Workspace-wide progress for the Reviews screen banner. */
export async function businessQueueStatus(businessId: string, now = new Date()) {
  await dbConnect();
  const [{ default: CampaignQueueItem }, { default: Campaign }, { default: Business }, { checkUsageLimit }] = await Promise.all([
    import('@/models/CampaignQueueItem'), import('@/models/Campaign'), import('@/models/Business'), import('@/lib/featureGating'),
  ]);
  const business: any = await Business.findById(businessId).select('userId').lean();
  const usage = business?.userId ? await checkUsageLimit(String(business.userId), businessId, 'whatsappMessages', 0) : { limit: 0, used: 0 };
  const active: any[] = await Campaign.find({ businessId, status: 'ACTIVE' }).select('_id').lean();
  const { start } = utcDayBounds(now);
  const [waiting, startedToday, remindersReserved] = await Promise.all([
    active.length ? CampaignQueueItem.countDocuments({ campaignId: { $in: active.map((c) => c._id) }, status: 'queued' }) : 0,
    CampaignQueueItem.countDocuments({ businessId, dispatchedAt: { $gte: start }, status: { $in: ['dispatched', 'sent'] } }),
    remindersDueToday(businessId, now),
  ]);
  const limit = typeof usage.limit === 'number' ? usage.limit : 0;
  const perDay = Math.max(0, campaignPerDay(limit) - remindersReserved);
  return {
    limit,
    sentToday: await sentOn(businessId, now),
    remindersReservedToday: remindersReserved,
    waiting,
    startedToday,
    // Rough: tomorrow's reminders are not known yet, so the full limit is assumed.
    daysLeft: daysToFinish(waiting, campaignPerDay(limit)),
    perDayToday: perDay,
    campaignPerDay: campaignPerDay(limit),
    manualWaiting: await manualWaiting(businessId),
    manualReserve: manualReserveFor(limit < 0 ? UNLIMITED_DAILY_CAP : limit),
  };
}


/**
 * A request sent by hand on a day whose WhatsApp limit is used: queued to go
 * out the next morning, before campaign customers. One "send tomorrow" list
 * per workspace (a Campaign with manualQueue). Returns false when the
 * customer is already waiting there.
 */
export async function queueManualRequest(businessId: string, organizationId: string, customerId: string): Promise<{ queued: boolean; message: string }> {
  await dbConnect();
  const { default: Campaign } = await import('@/models/Campaign');
  const list: any = await Campaign.findOneAndUpdate(
    { businessId, manualQueue: true },
    {
      $setOnInsert: { businessId, tenantId: organizationId, name: 'Requests sent on a full day', channel: 'WHATSAPP', manualQueue: true, targetTags: [] },
      $set: { status: 'ACTIVE', startedAt: new Date() },
    },
    { upsert: true, new: true },
  ).lean();
  const { added } = await enqueueCampaignCustomers(String(list._id), businessId, [customerId]);
  return {
    queued: added > 0,
    message: added > 0
      ? "Today's WhatsApp limit is used, so this review request will go out tomorrow morning — before any campaign messages."
      : 'This customer is already scheduled to get a review request tomorrow morning.',
  };
}

/** How many hand-sent requests are waiting for tomorrow (for the banner). */
export async function manualWaiting(businessId: string): Promise<number> {
  await dbConnect();
  const [{ default: Campaign }, { default: CampaignQueueItem }] = await Promise.all([import('@/models/Campaign'), import('@/models/CampaignQueueItem')]);
  const list: any = await Campaign.findOne({ businessId, manualQueue: true }).select('_id').lean();
  return list ? CampaignQueueItem.countDocuments({ campaignId: list._id, status: 'queued' }) : 0;
}
