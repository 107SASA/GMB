import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import { requireClient } from '@/lib/auth';
import { getRazorpay } from '@/lib/billing/razorpay';

/**
 * Cancels the user's Razorpay subscription (immediately). The downgrade of
 * entitlements happens when Razorpay's subscription.cancelled webhook
 * arrives — same single path as every other state change.
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

    await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId, false);

    return NextResponse.json({
      success: true,
      message: 'Subscription cancelled. Your plan will downgrade shortly.',
    });
  } catch (error: any) {
    console.error('Cancel subscription error:', error);
    return NextResponse.json(
      { error: error?.error?.description || error.message || 'Cancellation failed' },
      { status: 500 }
    );
  }
}
