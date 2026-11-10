/**
 * Records Business.googleAccess after each GBP sync (and when a live write is
 * refused) and acts on the transitions:
 *
 *   → verified (from checking / limited / blocked)
 *       start the first report + weekly posts (both idempotent), and spread
 *       posts that were held past their date over the next days
 *   → limited / blocked
 *       one in-app + push notice per problem (not on every 6-hourly sync)
 *
 * Inconclusive syncs (Google outage, rate limit) change nothing.
 */
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import GBPToken from '@/models/GBPToken';
import GbpLocationSnapshot from '@/models/GbpLocationSnapshot';
import { evaluateGoogleAccess, googleAccessCopy, type GoogleAccessVerdict } from './evaluate';
import type { SectionError } from '../intelligence/types';

type Prev = { state?: string; reason?: string | null; problemSince?: Date | null; noticeReason?: string | null; verifiedAt?: Date | null } | null | undefined;

const DAY_MS = 24 * 3_600_000;

/** Fresh sign-in: nothing runs until the first sync confirms access. */
export async function markGoogleAccessChecking(businessId: string, now = new Date()): Promise<void> {
  await dbConnect();
  await Business.updateOne(
    { _id: businessId },
    { $set: { googleAccess: { state: 'checking', reason: null, detail: null, checkedAt: null, verifiedAt: null, problemSince: now, noticeReason: null } } },
  );
}

export interface RecordResult {
  state: string | null;
  changed: boolean;
  becameVerified: boolean;
  noticeSent: boolean;
}

/** Persist a verdict and run the transition side effects. `null` verdict = inconclusive, nothing changes. */
export async function recordGoogleAccess(
  businessId: string,
  verdict: GoogleAccessVerdict | null,
  opts: { now?: Date; deps?: { onVerified?: (businessId: string) => Promise<void>; notify?: (businessId: string, v: GoogleAccessVerdict) => Promise<void> } } = {},
): Promise<RecordResult> {
  await dbConnect();
  const now = opts.now ?? new Date();
  const biz: any = await Business.findById(businessId).select('googleAccess').lean();
  if (!biz) return { state: null, changed: false, becameVerified: false, noticeSent: false };
  const prev: Prev = biz.googleAccess;
  if (!verdict) return { state: prev?.state ?? null, changed: false, becameVerified: false, noticeSent: false };

  const wasProblem = prev?.state === 'limited' || prev?.state === 'blocked' || prev?.state === 'checking';
  const isProblem = verdict.state !== 'verified';
  const becameVerified = !isProblem && prev?.state !== 'verified';
  // The revoked-token alert is already sent once by gbpClient (gbp_reauth_required).
  const wantsNotice = isProblem && prev?.noticeReason !== verdict.reason;
  const sendNotice = wantsNotice && verdict.reason !== 'token_revoked';

  const next = {
    state: verdict.state,
    reason: verdict.reason,
    detail: verdict.detail,
    canRead: verdict.canRead,
    canPost: verdict.canPost,
    canEdit: verdict.canEdit,
    checkedAt: now,
    verifiedAt: isProblem ? prev?.verifiedAt ?? null : becameVerified ? now : prev?.verifiedAt ?? now,
    problemSince: isProblem ? (wasProblem && prev?.problemSince ? prev.problemSince : now) : null,
    noticeReason: isProblem ? (wantsNotice ? verdict.reason : prev?.noticeReason ?? null) : null,
  };
  await Business.updateOne({ _id: businessId }, { $set: { googleAccess: next } });

  if (sendNotice) {
    try {
      await (opts.deps?.notify ?? notifyAccessProblem)(businessId, verdict);
    } catch (err: any) {
      console.error(`[googleAccess] notice failed for ${businessId}:`, err?.message);
    }
  }
  if (becameVerified) {
    try {
      await (opts.deps?.onVerified ?? onAccessVerified)(businessId);
    } catch (err: any) {
      console.error(`[googleAccess] start-after-verified failed for ${businessId}:`, err?.message);
    }
  }
  return { state: verdict.state, changed: prev?.state !== verdict.state || prev?.reason !== verdict.reason, becameVerified, noticeSent: sendNotice };
}

/**
 * Evaluate what the sync that just ran learned (snapshot sections + token
 * state + the metrics read) and record it. Called as the last step of
 * gbpSyncWorker. Never throws.
 */
export async function checkGoogleAccessAfterSync(
  businessId: string,
  input: { metricsError?: SectionError | null } = {},
  opts: Parameters<typeof recordGoogleAccess>[2] = {},
): Promise<RecordResult & { verdict: GoogleAccessVerdict | null }> {
  await dbConnect();
  const token: any = await GBPToken.findOne({ businessId }).select('locationId authStatus').lean();
  if (!token) return { state: null, changed: false, becameVerified: false, noticeSent: false, verdict: null };
  const snap: any = await GbpLocationSnapshot.findOne({ businessId }).select('locationId sections.location sections.verification').lean();
  const sameLocation = !!snap && snap.locationId === token.locationId;
  const verdict = evaluateGoogleAccess({
    authRevoked: token.authStatus?.state === 'REVOKED',
    location: sameLocation ? snap.sections?.location : null,
    verification: sameLocation ? snap.sections?.verification : null,
    metricsError: input.metricsError ?? null,
  });
  return { ...(await recordGoogleAccess(businessId, verdict, opts)), verdict };
}

/**
 * A live write (post publish) was refused with 401/403. Mark the business
 * blocked so nothing else is attempted until the next sync re-checks.
 */
export async function noteGoogleAccessRefused(businessId: string, message: string): Promise<void> {
  try {
    await recordGoogleAccess(businessId, {
      state: 'blocked', reason: 'no_permission', canRead: false, canPost: false, canEdit: false, detail: message.slice(0, 300),
    });
  } catch (err: any) {
    console.error(`[googleAccess] could not record refusal for ${businessId}:`, err?.message);
  }
}

async function notifyAccessProblem(businessId: string, v: GoogleAccessVerdict): Promise<void> {
  const copy = googleAccessCopy(v.state, v.reason);
  if (!copy) return;
  const { notifyBusinessUsers } = await import('@/services/notifications');
  await notifyBusinessUsers(businessId, { type: 'gbp_access_problem', title: copy.title, body: copy.body.slice(0, 300), link: '/dashboard/gbp-profile' });
  try {
    const { sendPushToBusinessUsers } = await import('@/services/push');
    await sendPushToBusinessUsers(businessId, { title: copy.title, body: copy.body.slice(0, 180), data: { link: '/dashboard/gbp-profile' } } as any);
  } catch { /* push is best-effort */ }
}

/**
 * Posts held while access was missing whose date has passed go out one per
 * day from tomorrow (not all at once). Future-dated posts keep their dates.
 */
export async function releaseHeldPosts(businessId: string, now = new Date()): Promise<number> {
  const { default: Post } = await import('@/models/Post');
  const overdue: any[] = await Post.find({ businessId, status: 'scheduled', scheduledDate: { $lte: now } })
    .sort({ scheduledDate: 1 }).select('_id').lean();
  const firstSlot = new Date(now.getTime() + DAY_MS);
  firstSlot.setUTCHours(4, 30, 0, 0); // 10:00 IST
  for (let i = 0; i < overdue.length; i++) {
    await Post.updateOne({ _id: overdue[i]._id, status: 'scheduled' }, { $set: { scheduledDate: new Date(firstSlot.getTime() + i * DAY_MS) } });
  }
  return overdue.length;
}

async function onAccessVerified(businessId: string): Promise<void> {
  await releaseHeldPosts(businessId);
  const { maybeStartAuditAutopilot } = await import('@/lib/auditAutopilot');
  const { maybeStartContentAutopilot } = await import('@/lib/contentAutopilot');
  await maybeStartAuditAutopilot(businessId);
  await maybeStartContentAutopilot(businessId);
}
