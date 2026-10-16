import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import User from '@/models/User';
import BillingEvent from '@/models/BillingEvent';
import BillingRecoveryEpisode from '@/models/BillingRecoveryEpisode';
import TrialClaim from '@/models/TrialClaim';
import AdminActionLog from '@/models/AdminActionLog';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { getRazorpay } from '@/lib/billing/razorpay';
import { buildMonitoringRow } from '@/lib/billing/monitoring';

export const dynamic = 'force-dynamic';

/**
 * One workspace's billing record for super admins: the monitoring row, the
 * billing event history, reminder episodes, its trial claim and admin actions.
 * Read-only. ?verify=1 asks Razorpay for the subscription's CURRENT status
 * (status fields only — never customer, card or payment details).
 */
export async function GET(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { businessId } = await params;
  if (!mongoose.isValidObjectId(businessId)) return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  await dbConnect();

  const business = await Business.findById(businessId).lean<any>();
  if (!business) return NextResponse.json({ success: false, error: 'Workspace not found.' }, { status: 404 });

  const [owner, events, episodes, claim, adminActions] = await Promise.all([
    business.userId ? User.findById(business.userId).select('fullName phone email isPhoneVerified subscriptionPlan').lean<any>() : null,
    BillingEvent.find({ businessId }).sort({ eventAt: -1, _id: -1 }).limit(100).lean<any[]>(),
    BillingRecoveryEpisode.find({ businessId }).sort({ createdAt: -1 }).limit(10).lean<any[]>(),
    TrialClaim.findOne({ $or: [{ holderBusinessId: business._id }, { businessId: business._id }] })
      .select('status reservedUntil consumedAt releasedAt releaseReason needsReview offer razorpaySubscriptionId history')
      .lean<any>(),
    AdminActionLog.find({ targetBusinessId: business._id }).sort({ createdAt: -1 }).limit(50).select('adminEmail action metadata createdAt').lean<any[]>(),
  ]);

  const lastCharge = events.find((e) => e.actions?.includes('activate_paid')) ?? null;
  const lastRazorpayEvent = events.find((e) => e.source === 'webhook' || e.source === 'reconcile') ?? null;

  let razorpay: Record<string, unknown> | null = null;
  const url = new URL(req.url);
  const subId = business.billingSubscriptionId ?? business.razorpaySubscriptionId;
  if (url.searchParams.get('verify') === '1' && subId) {
    const client = getRazorpay();
    if (!client) razorpay = { available: false, reason: 'billing not configured on this server' };
    else {
      try {
        const sub: any = await client.subscriptions.fetch(subId);
        razorpay = {
          available: true,
          subscriptionId: subId,
          status: sub.status ?? null,
          paidCount: sub.paid_count ?? null,
          currentEnd: typeof sub.current_end === 'number' ? new Date(sub.current_end * 1000) : null,
          chargeAt: typeof sub.charge_at === 'number' ? new Date(sub.charge_at * 1000) : null,
          endedAt: typeof sub.ended_at === 'number' ? new Date(sub.ended_at * 1000) : null,
          fetchedAt: new Date(),
        };
      } catch (err: any) {
        razorpay = { available: false, reason: err?.error?.description || 'Razorpay request failed' };
      }
    }
  }

  return NextResponse.json({
    success: true,
    row: buildMonitoringRow({ business, owner, episode: episodes[0] ?? null, lastCharge, lastRazorpayEvent }),
    razorpay,
    events: events.map((e) => ({
      id: String(e._id),
      type: e.eventType,
      source: e.source,
      at: e.eventAt,
      statusBefore: e.statusBefore ?? null,
      statusAfter: e.statusAfter ?? null,
      actions: e.actions ?? [],
      note: e.note ?? '',
      amountInr: e.amountPaise != null ? e.amountPaise / 100 : null,
      subscriptionId: e.razorpaySubscriptionId ?? null,
      needsReview: !!e.needsReview,
      reviewedAt: e.reviewedAt ?? null,
    })),
    episodes: episodes.map((ep) => ({
      id: String(ep._id),
      status: ep.status,
      stopReason: ep.stopReason ?? null,
      failedAt: ep.failedAt,
      remindersSent: ep.remindersSent,
      needsReview: !!ep.needsReview,
      reviewNote: ep.reviewNote ?? null,
      steps: ep.steps.map((s: any) => ({
        key: s.key, status: s.status, dueAt: s.dueAt, nextAttemptAt: s.nextAttemptAt, attempts: s.attempts,
        sentAt: s.sentAt ?? null, providerMessageId: s.providerMessageId ?? null, delivery: s.deliveryStatus ?? null,
        error: s.lastError ?? null, errorCode: s.lastErrorCode ?? null,
      })),
    })),
    trialClaim: claim
      ? {
          status: claim.status,
          reservedUntil: claim.reservedUntil ?? null,
          consumedAt: claim.consumedAt ?? null,
          releasedAt: claim.releasedAt ?? null,
          releaseReason: claim.releaseReason ?? null,
          needsReview: !!claim.needsReview,
          subscriptionId: claim.razorpaySubscriptionId ?? null,
          offer: claim.offer ? { trialMonths: claim.offer.trialMonths, trialEndsAt: claim.offer.trialEndsAt, amountInr: claim.offer.amountPaise / 100 } : null,
          history: claim.history ?? [],
        }
      : null,
    adminActions: adminActions.map((a) => ({ action: a.action, by: a.adminEmail ?? null, at: a.createdAt, metadata: a.metadata ?? null })),
  });
}
