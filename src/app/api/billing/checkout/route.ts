import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import Business from '@/models/Business';
import User from '@/models/User';
import { requireBusinessContext } from '@/lib/tenant';
import { getRazorpay, getRazorpayKeyId } from '@/lib/billing/razorpay';
import { ensureRazorpayPlanId } from '@/lib/billing/planCatalog';

/**
 * Creates a Razorpay Subscription for THE plan (there is only one), scoped to
 * the ACTIVE workspace, and returns the params the Razorpay JS widget needs.
 * The workspace is resolved from the business context (activeBusinessId cookie
 * / x-business-id header). Entitlements are NOT granted here — only the webhook
 * (subscription.activated/charged) flips them, so a closed checkout window
 * can't leave a half-activated state.
 */
export async function POST() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

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
        // The webhook resolves the user AND the workspace from these notes.
        userId: ctx.userId,
        businessId: ctx.businessId,
        planType: plan.planType,
      },
    });

    // Link the Razorpay subscription now (entitlements unchanged until the
    // webhook confirms payment). Linked on both the workspace (per-workspace
    // access gate) and the user's Subscription doc (usage-limit plumbing).
    await dbConnect();
    await Business.updateOne(
      { _id: ctx.businessId },
      { $set: { razorpaySubscriptionId: rpSubscription.id } }
    );
    await Subscription.findOneAndUpdate(
      { userId: ctx.userId },
      { $set: { razorpaySubscriptionId: rpSubscription.id } },
      { upsert: true, setDefaultsOnInsert: true }
    );

    const user = await User.findById(ctx.userId).select('email phone').lean<{ email?: string; phone?: string }>();

    return NextResponse.json({
      success: true,
      checkout: {
        key: getRazorpayKeyId(),
        subscriptionId: rpSubscription.id,
        planType: plan.planType,
        name: 'GrowwMatics AI',
        description: `${plan.displayName} — ₹${plan.priceInr}/${plan.billingCycle}`,
        prefill: {
          email: user?.email ?? undefined,
          contact: user?.phone ?? undefined,
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
