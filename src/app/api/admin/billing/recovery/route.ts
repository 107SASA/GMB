import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import BillingEvent from '@/models/BillingEvent';
import BillingRecoveryEpisode from '@/models/BillingRecoveryEpisode';
import TrialClaim from '@/models/TrialClaim';
import AdminActionLog from '@/models/AdminActionLog';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Operator view of payment recovery (minimal — the full monitoring UI is a
 * later phase): open failures and their reminder progress, and everything
 * that needs a human (failed/ambiguous Razorpay operations, ambiguous sends,
 * trial claims in doubt, recoveries on hold, failures with no episode).
 *
 * GET  → the lists below
 * POST { kind: 'episode' | 'billingEvent' | 'trialClaim', id, note? } → mark
 *      reviewed. Only clears the review flag (audited, old → new) — it never
 *      changes a subscription, a claim's status, or access, and it never
 *      re-sends an ambiguous WhatsApp message (at-most-once stays intact).
 *      Releasing a recovery hold is a separate action (…/release-hold).
 */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  await dbConnect();

  const now = new Date();
  const [episodes, reviewEvents, reviewClaims, holds, pastDue, stuckClaims, expiredCheckouts] = await Promise.all([
    BillingRecoveryEpisode.find({ $or: [{ status: 'open' }, { needsReview: true }] }).sort({ failedAt: -1 }).limit(200).lean<any[]>(),
    BillingEvent.find({ needsReview: true, reviewedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(200).lean<any[]>(),
    TrialClaim.find({ status: 'reserved', needsReview: true }).select('businessId razorpaySubscriptionId reservedUntil updatedAt').lean<any[]>(),
    Business.find({ paymentAccessHold: true }).select('name userId updatedAt').lean<any[]>(),
    Business.find({ subscriptionStatus: 'past_due' }).select('_id name paymentFailedAt paymentFailureKind paymentGraceEndsAt').lean<any[]>(),
    // A trial checkout window that passed without being settled (Razorpay not yet re-checked).
    TrialClaim.find({ status: 'reserved', needsReview: { $ne: true }, reservedUntil: { $lt: now } }).select('businessId razorpaySubscriptionId reservedUntil').limit(200).lean<any[]>(),
    // A recovery checkout that expired while the workspace is still past due.
    Business.find({ subscriptionStatus: 'past_due', 'recoveryCheckout.expiresAt': { $lt: now } }).select('_id name recoveryCheckout').lean<any[]>(),
  ]);

  const names = new Map<string, string>();
  const ids = [...new Set([...episodes.map((e) => String(e.businessId)), ...reviewEvents.map((e) => String(e.businessId ?? ''))].filter(Boolean))];
  for (const b of await Business.find({ _id: { $in: ids } }).select('name').lean<any[]>()) names.set(String(b._id), b.name);

  const withEpisode = new Set(episodes.filter((e) => e.status === 'open').map((e) => String(e.businessId)));
  return NextResponse.json({
    success: true,
    episodes: episodes.map((e) => {
      const next = e.steps.find((s: any) => s.status === 'pending' || s.status === 'retry');
      const attempted = e.steps.filter((s: any) => s.attempts > 0);
      const last = attempted[attempted.length - 1];
      return {
        id: String(e._id),
        businessId: String(e.businessId),
        businessName: names.get(String(e.businessId)) ?? null,
        status: e.status,
        stopReason: e.stopReason ?? null,
        failureKind: e.failureKind ?? null,
        failedAt: e.failedAt,
        remindersSent: e.remindersSent,
        nextReminder: next ? { key: next.key, at: next.nextAttemptAt } : null,
        lastAttempt: last
          ? {
              key: last.key,
              status: last.status,
              at: last.sentAt ?? last.claimedAt,
              providerMessageId: last.providerMessageId ?? null,
              deliveryStatus: last.deliveryStatus ?? null,
              error: last.lastError ?? null,
              errorCode: last.lastErrorCode ?? null,
            }
          : null,
        needsReview: !!e.needsReview,
      };
    }),
    needsReview: {
      billingOperations: reviewEvents.map((e) => ({
        id: String(e._id),
        businessId: e.businessId ? String(e.businessId) : null,
        businessName: e.businessId ? names.get(String(e.businessId)) ?? null : null,
        type: e.eventType,
        subscriptionId: e.razorpaySubscriptionId ?? null,
        note: e.note,
        at: e.createdAt,
      })),
      trialClaims: reviewClaims.map((c) => ({ id: String(c._id), businessId: String(c.businessId), subscriptionId: c.razorpaySubscriptionId ?? null, since: c.updatedAt })),
      // Never retried automatically — a person decides (the message may or may not have reached the customer).
      ambiguousSends: episodes.flatMap((e) =>
        (e.steps ?? [])
          .filter((s: any) => s.status === 'ambiguous')
          .map((s: any) => ({
            episodeId: String(e._id),
            businessId: String(e.businessId),
            businessName: names.get(String(e.businessId)) ?? null,
            step: s.key,
            at: s.claimedAt ?? null,
            reason: s.lastError ?? 'outcome unknown',
            reviewed: !e.needsReview,
          }))
      ),
      stuckTrialReservations: stuckClaims.map((c) => ({ id: String(c._id), businessId: String(c.businessId), subscriptionId: c.razorpaySubscriptionId ?? null, reservedUntil: c.reservedUntil })),
      expiredRecoveryCheckouts: expiredCheckouts.map((b) => ({ businessId: String(b._id), name: b.name, subscriptionId: b.recoveryCheckout?.subscriptionId ?? null, expiredAt: b.recoveryCheckout?.expiresAt ?? null })),
      recoveriesOnHold: holds.map((b) => ({ businessId: String(b._id), name: b.name, since: b.updatedAt })),
      failuresWithoutEpisode: pastDue
        .filter((b) => !withEpisode.has(String(b._id)))
        .map((b) => ({ businessId: String(b._id), name: b.name, failedAt: b.paymentFailedAt ?? null, kind: b.paymentFailureKind ?? null })),
    },
  });
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  await dbConnect();

  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  const id = body?.id;
  if (!['episode', 'billingEvent', 'trialClaim'].includes(kind) || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
    return NextResponse.json({ success: false, error: "Send { kind: 'episode' | 'billingEvent' | 'trialClaim', id }." }, { status: 400 });
  }
  const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : '';
  const reviewedAt = new Date();
  // Only the review flag changes — never status, access, a claim, or a send.
  const res =
    kind === 'episode'
      ? await BillingRecoveryEpisode.updateOne({ _id: id, needsReview: true }, { $set: { needsReview: false, reviewNote: note } })
      : kind === 'billingEvent'
        ? await BillingEvent.updateOne({ _id: id, needsReview: true }, { $set: { reviewedAt } })
        : await TrialClaim.updateOne({ _id: id, needsReview: true }, { $set: { needsReview: false } });
  if (res.matchedCount === 0) return NextResponse.json({ success: false, error: 'Nothing to review with that id.' }, { status: 404 });

  try {
    await AdminActionLog.create({
      adminUserId: auth.userId,
      adminEmail: (auth.user as any)?.email,
      action: `billing.review.${kind}`,
      ip: getClientIp(req),
      metadata: {
        id,
        note,
        old: { needsReview: true },
        new: kind === 'billingEvent' ? { needsReview: true, reviewedAt } : { needsReview: false },
      },
    });
  } catch (e: any) {
    console.error('[admin/billing/recovery] audit log write failed:', e?.message);
  }
  return NextResponse.json({ success: true });
}
