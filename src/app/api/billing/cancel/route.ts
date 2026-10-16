import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';
import { getRazorpay } from '@/lib/billing/razorpay';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { markTrialCancelled } from '@/lib/billing/applyEntitlements';
import { cancelTarget, pickCancelWorkspace } from '@/lib/billing/cancelTarget';

/**
 * Cancels the ACTIVE WORKSPACE's Razorpay subscription AT THE END OF THE
 * CURRENT CYCLE (cancel_at_cycle_end=true). We don't refund, so access
 * continues until the period the customer already paid for ends — the
 * workspace stays 'active' (unlocked) until then. Razorpay fires
 * subscription.cancelled at cycle end, which downgrades entitlements; a daily
 * safety cron also enforces the cutoff and sends 10/5/3/2/1-day reminders
 * (see services/inngest/functions.ts).
 *
 * The subscription cancelled is the one PAYING for the workspace
 * (lib/billing/cancelTarget.ts) — never the user-level checkout link, which
 * may point at a newer unpaid checkout of another workspace. Owner only.
 */
export async function POST() {
  try {
    const auth = await requireClient();
    if (!auth.ok) return auth.response;

    await dbConnect();
    const selectedId =
      (await headers()).get('x-business-id') || (await cookies()).get('activeBusinessId')?.value || null;
    const owned = await Business.find({ userId: auth.userId, isDeleted: { $ne: true } })
      .select('_id subscriptionStatus billingSubscriptionId razorpaySubscriptionId trialEndsAt trialCancelledAt')
      .lean<any[]>();
    const picked = pickCancelWorkspace(owned, selectedId);
    if (!picked.ok) {
      if (picked.reason === 'not_owner') {
        return NextResponse.json({ error: 'Only the workspace owner can cancel its subscription.' }, { status: 403 });
      }
      if (picked.reason === 'ambiguous') {
        return NextResponse.json({ error: 'Select the workspace whose subscription you want to cancel, then try again.', code: 'SELECT_WORKSPACE' }, { status: 409 });
      }
      return NextResponse.json({ error: 'No active paid subscription to cancel' }, { status: 400 });
    }
    const workspace = picked.workspace;
    const target = cancelTarget(workspace);
    if (target.kind === 'none') {
      return NextResponse.json({ error: 'No active paid subscription to cancel' }, { status: 400 });
    }

    const razorpay = getRazorpay();
    if (!razorpay) {
      return NextResponse.json(
        { error: 'Billing is not configured on this server' },
        { status: 503 }
      );
    }

    // Free trial: cancel on Razorpay NOW (an authenticated future-start
    // subscription has no billing cycle, so cycle-end cancel is rejected) and
    // confirm Razorpay reports it cancelled before promising "no charge".
    // Access continues until the original trial end — never extended.
    if (target.kind === 'trial') {
      const endLabel = new Date(workspace.trialEndsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      if (!target.alreadyCancelled) {
        try {
          await razorpay.subscriptions.cancel(target.subscriptionId, false);
        } catch (err: any) {
          console.warn('[billing/cancel] trial cancel call failed, re-checking state:', err?.error?.description || err?.message);
        }
        const rp: any = await razorpay.subscriptions.fetch(target.subscriptionId);
        if (rp?.status !== 'cancelled') {
          return NextResponse.json(
            { error: 'We could not confirm the cancellation with our payment provider. Please try again in a minute, or contact support.' },
            { status: 502 }
          );
        }
        await markTrialCancelled(String(workspace._id), auth.userId);
      }
      return NextResponse.json({
        success: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: workspace.trialEndsAt,
        message: `Free trial cancelled. You keep full access until ${endLabel} and won't be charged.`,
      });
    }

    // true → cancel at cycle end (keep access until the paid period ends).
    await razorpay.subscriptions.cancel(target.subscriptionId, true);

    // Flag the workspace(s) this subscription pays for: still 'active'
    // (unlocked) but scheduled to end. Reset reminder tracking so the
    // countdown notices fire.
    await Business.updateMany(
      { $or: [{ _id: workspace._id }, { billingSubscriptionId: target.subscriptionId }] },
      { $set: { subscriptionCancelAtPeriodEnd: true, subscriptionRemindersSent: [] } }
    );

    // Read the paid-through date for a clear message.
    const ws = await Business.findById(workspace._id)
      .select('subscriptionCurrentPeriodEnd')
      .lean() as any;
    const endsAt: Date | null = ws?.subscriptionCurrentPeriodEnd ?? null;

    return NextResponse.json({
      success: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: endsAt,
      message: endsAt
        ? `Subscription cancelled. You keep full access until ${new Date(endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, then it won't renew.`
        : 'Subscription cancelled. You keep full access until the end of your current billing period, then it won\'t renew.',
    });
  } catch (error: any) {
    console.error('Cancel subscription error:', error);
    return NextResponse.json(
      { error: error?.error?.description || toFriendlyMessage(error) },
      { status: 500 }
    );
  }
}
