import mongoose from 'mongoose';
import ReviewRequest from '@/models/ReviewRequest';
import Campaign from '@/models/Campaign';
import Review from '@/models/Review';
import ProfileActivity from '@/models/ProfileActivity';
import Post from '@/models/Post';
import AdminActionLog from '@/models/AdminActionLog';
import CustomerCallLog from '@/models/CustomerCallLog';

/**
 * Customer activity for the super admin — "is this owner actually using the
 * product?" Powers the status column / "Needs a call" filter on
 * /admin/customers and the Activity tab on /admin/customers/[userId].
 *
 * OWNER actions (what counts as the customer being active):
 *   - opening the dashboard or app (User.lastSeenAt / lastLoginAt)
 *   - sending review requests (ReviewRequest) / starting a campaign (Campaign)
 *   - approving a review reply themselves (Review.replyApprovedBy === 'owner')
 *   - editing their Google profile / photos (ProfileActivity)
 * Automatic things (posts the AI published, new reviews arriving) are shown in
 * the timeline as RESULTS but never count as the owner being active.
 *
 * Admin "login as customer" changes: the records themselves don't say who made
 * them, so any owner-action record that lands within a few minutes after a
 * logged admin action on that workspace (AdminActionLog 'impersonate.action',
 * written by proxy.ts) is attributed to the admin and excluded.
 */

export const ACTIVITY_RULES = {
  /** No owner activity for this many days → Slipping. */
  slippingDays: 7,
  /** No owner activity for this many days → Inactive. */
  inactiveDays: 14,
  /** Posts waiting on the owner's approval longer than this → Slipping. */
  pendingPostDays: 5,
  /** Zero review requests in 30 days → Inactive, once the account is this old. */
  noRequestsGraceDays: 14,
} as const;

export type ActivityStatus = 'active' | 'slipping' | 'inactive';

const DAY = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 180;
/** A record this long after an admin action on the same workspace counts as the admin's. */
const ADMIN_MATCH_BEFORE_MS = 5_000;
const ADMIN_MATCH_AFTER_MS = 10 * 60 * 1000;

export interface OwnerInput {
  userId: string;
  createdAt?: Date | string;
  lastSeenAt?: Date | string | null;
  lastSeenClient?: string | null;
  lastLoginAt?: Date | string | null;
  business?: { _id: string; googleConnected?: boolean } | null;
}

export interface ActivitySummary {
  status: ActivityStatus;
  reasons: string[];
  lastActivityAt: string | null;
  daysQuiet: number | null;
  lastSeenAt: string | null;
  lastSeenClient: string | null;
  lastLoginAt: string | null;
  reviewRequests30d: number;
  lastReviewRequestAt: string | null;
  campaigns30d: number;
  ownerReplies30d: number;
  profileEdits30d: number;
  postsPending: number;
  oldestPendingDays: number | null;
  postsPublished30d: number;
  newReviews30d: number;
  googleConnected: boolean;
  adminActions30d: number;
  lastCall: { at: string; outcome: string; adminName?: string; note?: string; followUpAt?: string | null } | null;
}

type Stat = { count30: number; lastAt: Date | null };
type AdminTimes = Map<string, number[]>;

const toOid = (id: string) => new mongoose.Types.ObjectId(id);
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const daysSince = (d: Date | null, now: number) => (d ? Math.floor((now - d.getTime()) / DAY) : null);

function isAdminTime(t: number, times: number[] | undefined): boolean {
  if (!times || times.length === 0) return false;
  return times.some((a) => t >= a - ADMIN_MATCH_BEFORE_MS && t <= a + ADMIN_MATCH_AFTER_MS);
}

async function adminActionTimes(bizIds: string[], since: Date): Promise<AdminTimes> {
  const map: AdminTimes = new Map();
  if (bizIds.length === 0) return map;
  const rows = await AdminActionLog.find({
    action: 'impersonate.action',
    targetBusinessId: { $in: bizIds.map(toOid) },
    createdAt: { $gte: since },
  }).select('targetBusinessId createdAt').lean();
  for (const r of rows as any[]) {
    const k = String(r.targetBusinessId);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(new Date(r.createdAt).getTime());
  }
  return map;
}

/**
 * Per-workspace count (last 30 days) + most recent time of one owner-action
 * source. Aggregated for everyone; recomputed record-by-record only for the
 * few workspaces an admin acted in, to drop the admin's changes.
 */
async function ownerSourceStats(
  model: mongoose.Model<any>,
  dateField: string,
  extraMatch: Record<string, unknown>,
  bizIds: string[],
  adminTimes: AdminTimes,
  now: number,
): Promise<Map<string, Stat>> {
  const out = new Map<string, Stat>();
  if (bizIds.length === 0) return out;
  const since = new Date(now - HISTORY_DAYS * DAY);
  const since30 = new Date(now - 30 * DAY);

  const rows = await model.aggregate([
    { $match: { businessId: { $in: bizIds.map(toOid) }, [dateField]: { $gte: since }, ...extraMatch } },
    {
      $group: {
        _id: '$businessId',
        count30: { $sum: { $cond: [{ $gte: [`$${dateField}`, since30] }, 1, 0] } },
        lastAt: { $max: `$${dateField}` },
      },
    },
  ]);
  for (const r of rows) out.set(String(r._id), { count30: r.count30, lastAt: r.lastAt ? new Date(r.lastAt) : null });

  for (const [biz, times] of adminTimes) {
    if (!out.has(biz)) continue;
    const docs = await model
      .find({ businessId: toOid(biz), [dateField]: { $gte: since }, ...extraMatch })
      .select(dateField)
      .sort({ [dateField]: -1 })
      .limit(5000)
      .lean();
    let count30 = 0;
    let lastAt: Date | null = null;
    for (const d of docs as any[]) {
      const t = new Date(d[dateField]).getTime();
      if (isAdminTime(t, times)) continue;
      if (!lastAt) lastAt = new Date(t);
      if (t >= since30.getTime()) count30++;
    }
    out.set(biz, { count30, lastAt });
  }
  return out;
}

const maxDate = (...ds: Array<Date | null | undefined>): Date | null =>
  ds.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

/** Activity summary for many owners in one go (Customers list). */
export async function summarizeOwners(owners: OwnerInput[]): Promise<Map<string, ActivitySummary>> {
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY);
  const bizIds = [...new Set(owners.map((o) => o.business?._id).filter((x): x is string => !!x && mongoose.Types.ObjectId.isValid(x)))];
  const userIds = owners.map((o) => o.userId).filter((x) => mongoose.Types.ObjectId.isValid(x));

  const adminTimes = await adminActionTimes(bizIds, new Date(now - HISTORY_DAYS * DAY));
  const bizOids = bizIds.map(toOid);

  const [requests, campaigns, replies, edits, pending, published, newReviews, calls] = await Promise.all([
    ownerSourceStats(ReviewRequest as any, 'createdAt', {}, bizIds, adminTimes, now),
    ownerSourceStats(Campaign as any, 'createdAt', {}, bizIds, adminTimes, now),
    ownerSourceStats(Review as any, 'replyApprovedAt', { replyApprovedBy: 'owner' }, bizIds, adminTimes, now),
    ownerSourceStats(ProfileActivity as any, 'createdAt', {}, bizIds, adminTimes, now),
    bizIds.length
      ? Post.aggregate([
          { $match: { businessId: { $in: bizOids }, status: 'pending_approval' } },
          { $group: { _id: '$businessId', n: { $sum: 1 }, oldest: { $min: '$createdAt' } } },
        ])
      : Promise.resolve([]),
    bizIds.length
      ? Post.aggregate([
          { $match: { businessId: { $in: bizOids }, status: 'published', publishedAt: { $gte: since30 } } },
          { $group: { _id: '$businessId', n: { $sum: 1 } } },
        ])
      : Promise.resolve([]),
    bizIds.length
      ? Review.aggregate([
          { $match: { businessId: { $in: bizOids }, postedAt: { $gte: since30 } } },
          { $group: { _id: '$businessId', n: { $sum: 1 } } },
        ])
      : Promise.resolve([]),
    userIds.length
      ? CustomerCallLog.aggregate([
          { $match: { userId: { $in: userIds.map(toOid) } } },
          { $sort: { createdAt: -1 } },
          { $group: { _id: '$userId', last: { $first: '$$ROOT' } } },
        ])
      : Promise.resolve([]),
  ]);

  const byId = (rows: any[]) => new Map(rows.map((r) => [String(r._id), r]));
  const pendingMap = byId(pending);
  const publishedMap = byId(published);
  const newReviewMap = byId(newReviews);
  const callMap = byId(calls);

  const out = new Map<string, ActivitySummary>();
  for (const o of owners) {
    const biz = o.business?._id ?? '';
    const req = requests.get(biz);
    const camp = campaigns.get(biz);
    const rep = replies.get(biz);
    const edit = edits.get(biz);
    const pend = pendingMap.get(biz);
    const lastSeen = o.lastSeenAt ? new Date(o.lastSeenAt) : null;
    const lastLogin = o.lastLoginAt ? new Date(o.lastLoginAt) : null;
    const lastAction = maxDate(req?.lastAt, camp?.lastAt, rep?.lastAt, edit?.lastAt);
    const lastActivity = maxDate(lastSeen, lastLogin, lastAction);
    const quiet = daysSince(lastActivity, now);
    const accountAgeDays = o.createdAt ? Math.floor((now - new Date(o.createdAt).getTime()) / DAY) : 999;
    const oldestPendingDays = pend?.oldest ? daysSince(new Date(pend.oldest), now) : null;
    const reviewRequests30d = req?.count30 ?? 0;
    const googleConnected = !!o.business?.googleConnected;

    // Status — the worst signal wins.
    const reasons: string[] = [];
    let level = 0; // 0 active, 1 slipping, 2 inactive
    const bump = (l: number, why: string) => { level = Math.max(level, l); reasons.push(why); };

    if (!o.business) {
      bump(2, 'No business set up');
    } else {
      if (quiet === null) bump(2, 'Never opened the dashboard or app');
      else if (quiet >= ACTIVITY_RULES.inactiveDays) bump(2, `No activity for ${quiet} days`);
      else if (quiet >= ACTIVITY_RULES.slippingDays) bump(1, `No activity for ${quiet} days`);

      if (reviewRequests30d === 0 && accountAgeDays >= ACTIVITY_RULES.noRequestsGraceDays) {
        bump(2, 'No review requests sent in 30 days');
      }
      if (oldestPendingDays !== null && oldestPendingDays > ACTIVITY_RULES.pendingPostDays) {
        bump(1, `${pend.n} post${pend.n === 1 ? '' : 's'} waiting for approval for ${oldestPendingDays} days`);
      }
      if (!googleConnected) bump(1, 'Google profile not connected');
    }

    const call = callMap.get(o.userId)?.last;
    out.set(o.userId, {
      status: (['active', 'slipping', 'inactive'] as const)[level],
      reasons,
      lastActivityAt: iso(lastActivity),
      daysQuiet: quiet,
      lastSeenAt: iso(lastSeen),
      lastSeenClient: o.lastSeenClient ?? null,
      lastLoginAt: iso(lastLogin),
      reviewRequests30d,
      lastReviewRequestAt: iso(req?.lastAt),
      campaigns30d: camp?.count30 ?? 0,
      ownerReplies30d: rep?.count30 ?? 0,
      profileEdits30d: edit?.count30 ?? 0,
      postsPending: pend?.n ?? 0,
      oldestPendingDays,
      postsPublished30d: publishedMap.get(biz)?.n ?? 0,
      newReviews30d: newReviewMap.get(biz)?.n ?? 0,
      googleConnected,
      adminActions30d: (adminTimes.get(biz) ?? []).filter((t) => t >= since30.getTime()).length,
      lastCall: call
        ? { at: iso(call.createdAt)!, outcome: call.outcome, adminName: call.adminName, note: call.note, followUpAt: iso(call.followUpAt) }
        : null,
    });
  }
  return out;
}

/** Plain-language lines for whoever makes the call. */
export function talkingPoints(s: ActivitySummary, businessName?: string): string[] {
  const pts: string[] = [];
  if (s.daysQuiet === null) pts.push(`Has never opened the ${businessName ? businessName + ' ' : ''}dashboard or app`);
  else if (s.daysQuiet >= ACTIVITY_RULES.slippingDays) pts.push(`Hasn't used the dashboard or app for ${s.daysQuiet} days`);
  if (s.reviewRequests30d === 0) {
    pts.push(s.lastReviewRequestAt
      ? `0 review requests in the last 30 days (last one ${Math.floor((Date.now() - Date.parse(s.lastReviewRequestAt)) / DAY)} days ago). More reviews are the biggest driver of ranking.`
      : 'Has never sent a review request themselves. Walk them through sending the first batch to recent customers.');
  } else {
    pts.push(`Sent ${s.reviewRequests30d} review request${s.reviewRequests30d === 1 ? '' : 's'} in the last 30 days`);
  }
  if (s.postsPending > 0) {
    pts.push(`${s.postsPending} post${s.postsPending === 1 ? ' is' : 's are'} waiting for their approval${s.oldestPendingDays ? ` (oldest ${s.oldestPendingDays} days)` : ''}. Nothing gets published until they approve.`);
  }
  if (!s.googleConnected) pts.push('Google Business Profile is not connected, so posts and replies can\'t go live');
  if (s.newReviews30d > 0) pts.push(`Good news to share: ${s.newReviews30d} new review${s.newReviews30d === 1 ? '' : 's'} in the last 30 days`);
  if (s.postsPublished30d > 0) pts.push(`${s.postsPublished30d} post${s.postsPublished30d === 1 ? '' : 's'} published for them in the last 30 days`);
  if (s.lastCall) {
    const d = Math.floor((Date.now() - Date.parse(s.lastCall.at)) / DAY);
    pts.push(`Last call ${d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`} by ${s.lastCall.adminName || 'admin'}: ${s.lastCall.outcome.replace(/_/g, ' ')}${s.lastCall.note ? `. "${s.lastCall.note}"` : ''}`);
  }
  return pts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline (customer detail page)
// ─────────────────────────────────────────────────────────────────────────────

export type TimelineKind = 'owner' | 'result' | 'admin' | 'call' | 'alert';

export interface TimelineItem {
  at: string;
  kind: TimelineKind;
  icon: string; // material symbol name
  title: string;
  detail?: string;
}

/** Newest-first activity feed for one customer's workspace (last `days` days). */
export async function buildTimeline(opts: {
  userId: string;
  businessId?: string | null;
  lastLoginAt?: Date | string | null;
  days?: number;
}): Promise<TimelineItem[]> {
  const days = opts.days ?? 60;
  const now = Date.now();
  const since = new Date(now - days * DAY);
  const items: TimelineItem[] = [];
  const biz = opts.businessId && mongoose.Types.ObjectId.isValid(opts.businessId) ? opts.businessId : null;

  if (opts.lastLoginAt && new Date(opts.lastLoginAt) >= since) {
    items.push({ at: iso(opts.lastLoginAt)!, kind: 'owner', icon: 'login', title: 'Logged in' });
  }

  const calls = await CustomerCallLog.find({ userId: opts.userId, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(50).lean();
  for (const c of calls as any[]) {
    items.push({
      at: iso(c.createdAt)!,
      kind: 'call',
      icon: 'call',
      title: `${c.adminName || 'Admin'} called: ${String(c.outcome).replace(/_/g, ' ')}`,
      detail: [c.note, c.followUpAt ? `Follow up ${new Date(c.followUpAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(' · ') || undefined,
    });
  }

  if (!biz) return sortTimeline(items);
  const bizOid = toOid(biz);

  const [adminLogs, requests, campaigns, replies, edits, published, reviews, pending] = await Promise.all([
    AdminActionLog.find({ targetBusinessId: bizOid, action: /^impersonate\./, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(300).lean(),
    ReviewRequest.find({ businessId: bizOid, createdAt: { $gte: since } }).select('createdAt status').sort({ createdAt: -1 }).limit(2000).lean(),
    Campaign.find({ businessId: bizOid, createdAt: { $gte: since } }).select('name createdAt').sort({ createdAt: -1 }).limit(50).lean(),
    Review.find({ businessId: bizOid, replyApprovedBy: 'owner', replyApprovedAt: { $gte: since } }).select('reviewer rating replyApprovedAt').sort({ replyApprovedAt: -1 }).limit(100).lean(),
    ProfileActivity.find({ businessId: bizOid, createdAt: { $gte: since } }).select('title detail updatedBy createdAt').sort({ createdAt: -1 }).limit(100).lean(),
    Post.find({ businessId: bizOid, status: 'published', publishedAt: { $gte: since } }).select('title content publishedAt').sort({ publishedAt: -1 }).limit(100).lean(),
    Review.find({ businessId: bizOid, postedAt: { $gte: since } }).select('reviewer rating postedAt').sort({ postedAt: -1 }).limit(100).lean(),
    Post.find({ businessId: bizOid, status: 'pending_approval' }).select('createdAt').sort({ createdAt: 1 }).lean(),
  ]);

  const adminTimes = (adminLogs as any[]).filter((l) => l.action === 'impersonate.action').map((l) => new Date(l.createdAt).getTime());
  const byAdmin = (d: Date | string) => isAdminTime(new Date(d).getTime(), adminTimes);
  const who = (owner: boolean) => (owner ? 'owner' : 'admin') as TimelineKind;

  // Admin sessions: one line per enter/exit, actions grouped per day.
  const adminActionsByDay = new Map<string, { at: string; n: number; admin: string }>();
  for (const l of adminLogs as any[]) {
    const admin = l.adminEmail || 'Admin';
    if (l.action === 'impersonate.start') items.push({ at: iso(l.createdAt)!, kind: 'admin', icon: 'admin_panel_settings', title: `${admin} logged in as this customer` });
    else if (l.action === 'impersonate.stop') items.push({ at: iso(l.createdAt)!, kind: 'admin', icon: 'logout', title: `${admin} exited${l.metadata?.minutes != null ? ` after ${l.metadata.minutes} min` : ''}` });
    else {
      const day = `${dayKey(l.createdAt)}|${admin}`;
      const g = adminActionsByDay.get(day);
      if (g) g.n++; else adminActionsByDay.set(day, { at: iso(l.createdAt)!, n: 1, admin });
    }
  }
  for (const g of adminActionsByDay.values()) {
    items.push({ at: g.at, kind: 'admin', icon: 'edit', title: `${g.admin} made ${g.n} change${g.n === 1 ? '' : 's'} as this customer` });
  }

  // Review requests: grouped per day (a campaign sends many at once).
  const reqByDay = new Map<string, { at: string; n: number; admin: number }>();
  for (const r of requests as any[]) {
    const k = dayKey(r.createdAt);
    const g = reqByDay.get(k) ?? { at: iso(r.createdAt)!, n: 0, admin: 0 };
    g.n++; if (byAdmin(r.createdAt)) g.admin++;
    reqByDay.set(k, g);
  }
  for (const g of reqByDay.values()) {
    const owner = g.admin < g.n;
    items.push({ at: g.at, kind: who(owner), icon: 'forward_to_inbox', title: `Sent ${g.n} review request${g.n === 1 ? '' : 's'}${owner ? '' : ' (by admin)'}` });
  }
  for (const c of campaigns as any[]) {
    const owner = !byAdmin(c.createdAt);
    items.push({ at: iso(c.createdAt)!, kind: who(owner), icon: 'campaign', title: `Started review campaign "${c.name}"${owner ? '' : ' (by admin)'}` });
  }
  for (const r of replies as any[]) {
    const owner = !byAdmin(r.replyApprovedAt);
    items.push({ at: iso(r.replyApprovedAt)!, kind: who(owner), icon: 'reply', title: `Approved a reply to ${r.reviewer}'s ${r.rating}★ review${owner ? '' : ' (by admin)'}` });
  }
  for (const e of edits as any[]) {
    const owner = !byAdmin(e.createdAt);
    items.push({ at: iso(e.createdAt)!, kind: who(owner), icon: 'storefront', title: `${e.title}${owner ? '' : ' (by admin)'}`, detail: e.detail });
  }
  for (const p of published as any[]) {
    items.push({ at: iso(p.publishedAt)!, kind: 'result', icon: 'article', title: 'Post published on Google', detail: (p.title || p.content || '').slice(0, 90) || undefined });
  }
  for (const r of reviews as any[]) {
    items.push({ at: iso(r.postedAt)!, kind: 'result', icon: 'star', title: `New ${r.rating}★ review from ${r.reviewer}` });
  }
  if ((pending as any[]).length > 0) {
    const oldest = new Date((pending as any[])[0].createdAt);
    items.push({
      at: new Date(now).toISOString(),
      kind: 'alert',
      icon: 'pending_actions',
      title: `${pending.length} post${pending.length === 1 ? '' : 's'} waiting for the owner's approval`,
      detail: `Oldest has been waiting ${Math.floor((now - oldest.getTime()) / DAY)} days`,
    });
  }

  return sortTimeline(items);
}

function dayKey(d: Date | string): string {
  // Group by IST calendar day — that's the customer's (and team's) day.
  return new Date(new Date(d).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function sortTimeline(items: TimelineItem[]): TimelineItem[] {
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 200);
}
