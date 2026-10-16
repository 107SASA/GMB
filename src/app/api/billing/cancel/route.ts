import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';
import { getRazorpay } from '@/lib/billing/razorpay';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { markTrialCancelled } from '@/lib/billing/applyEntitlements';

/**
 * Cancels the user's Razorpay subscription AT THE END OF THE CURRENT CYCLE
 * (cancel_at_cycle_end=true). We don't refund, so access continues until the
 * period the customer already paid for ends — the workspace stays 'active'
 * (unlocked) until then. Razorpay fires subscription.cancelled at cycle end,
 * which downgrades entitlements; a daily safety cron also enforces the cutoff
 * and sends 10/5/3/2/1-day reminders (see services/inngest/functions.ts).
 */
export async function POST() {
  try {
    const auth = await requireClient();
    if (!auth.ok) return auth.response;

    await dbConnect();
    const subscription = await Subscription.findOne({ userId: auth.userId })
      .select('razorpaySubscriptionId billingStatus')
      .lean() as any;

    if (!subscription?.razorpaySubscriptionId) {
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
    const trialWorkspace = await Business.findOne({
      billingSubscriptionId: subscription.razorpaySubscriptionId,
      subscriptionStatus: 'trial_active',
    })
      .select('_id trialEndsAt trialCancelledAt')
      .lean() as any;
    if (trialWorkspace) {
      const endLabel = new Date(trialWorkspace.trialEndsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      if (!trialWorkspace.trialCancelledAt) {
        try {
          await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId, false);
        } catch (err: any) {
          console.warn('[billing/cancel] trial cancel call failed, re-checking state:', err?.error?.description || err?.message);
        }
        const rp: any = await razorpay.subscriptions.fetch(subscription.razorpaySubscriptionId);
        if (rp?.status !== 'cancelled') {
          return NextResponse.json(
            { error: 'We could not confirm the cancellation with our payment provider. Please try again in a minute, or contact support.' },
            { status: 502 }
          );
        }
        await markTrialCancelled(trialWorkspace._id.toString(), auth.userId);
      }
      return NextResponse.json({
        success: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: trialWorkspace.trialEndsAt,
        message: `Free trial cancelled. You keep full access until ${endLabel} and won't be charged.`,
      });
    }

    // true → cancel at cycle end (keep access until the paid period ends).
    await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId, true);

    // Flag the workspace(s) on this subscription: still 'active' (unlocked) but
    // scheduled to end. Reset reminder tracking so the countdown notices fire.
    await Business.updateMany(
      { razorpaySubscriptionId: subscription.razorpaySubscriptionId },
      { $set: { subscriptionCancelAtPeriodEnd: true, subscriptionRemindersSent: [] } }
    );

    // Read the paid-through date for a clear message.
    const ws = await Business.findOne({ razorpaySubscriptionId: subscription.razorpaySubscriptionId })
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
