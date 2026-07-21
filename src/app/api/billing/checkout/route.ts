import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import { requireClient } from '@/lib/auth';
import { getRazorpay, getRazorpayKeyId } from '@/lib/billing/razorpay';
import { ensureRazorpayPlanId } from '@/lib/billing/planCatalog';

/**
 * Creates a Razorpay Subscription for THE plan (there is only one) and
 * returns the params the Razorpay JS widget needs. No request body is
 * required. Entitlements are NOT granted here — only the webhook
 * (subscription.activated/charged) flips them, so a closed checkout window
 * can't leave a half-activated state.
 */
export async function POST() {
  try {
    const auth = await requireClient();
    if (!auth.ok) return auth.response;

    const razorpay = getRazorpay();
    if (!razorpay) {
      return NextResponse.json(
        { error: 'Billing is not configured on this server' },
        { status: 503 }
      );
    }

    // Resolves the super-admin-configured price, creating a matching
    // Razorpay Plan on the fly if the price changed since the last one.
    const plan = await ensureRazorpayPlanId();
    if (!plan.razorpayPlanId) {
      return NextResponse.json(
        { error: 'Billing is not configured on this server' },
        { status: 503 }
      );
    }

    const rpSubscription = await razorpay.subscriptions.create({
      plan_id: plan.razorpayPlanId,
      customer_notify: 1,
      total_count: 12, // 12 monthly charges; Razorpay auto-renews the cycle
      notes: {
        // The webhook resolves the user from these notes.
        userId: auth.userId,
        planType: plan.planType,
      },
    });

    // Link the Razorpay subscription now (entitlements unchanged until the
    // webhook confirms payment).
    await dbConnect();
    await Subscription.findOneAndUpdate(
      { userId: auth.userId },
      { $set: { razorpaySubscriptionId: rpSubscription.id } },
      { upsert: true, setDefaultsOnInsert: true }
    );

    return NextResponse.json({
      success: true,
      checkout: {
        key: getRazorpayKeyId(),
        subscriptionId: rpSubscription.id,
        planType: plan.planType,
        name: 'GMB Boost',
        description: `${plan.displayName} — ₹${plan.priceInr}/${plan.billingCycle}`,
        prefill: {
          email: (auth.user as any).email ?? undefined,
          contact: (auth.user as any).phone ?? undefined,
        },
      },
    });
  } catch (error: any) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: error?.error?.description || error.message || 'Checkout failed' },
      { status: 500 }
    );
  }
}
