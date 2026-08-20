import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import Business from '@/models/Business';
import User from '@/models/User';
import { requireBusinessContext } from '@/lib/tenant';
import { getRazorpay, getRazorpayKeyId } from '@/lib/billing/razorpay';
import { ensureRazorpayPlanIdForCycle, getActivePlan, isBillingCycle, CYCLES, type BillingCycle } from '@/lib/billing/planCatalog';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * Creates a Razorpay Subscription for THE plan (there is only one), scoped to
 * the ACTIVE workspace, and returns the params the Razorpay JS widget needs.
 * The workspace is resolved from the business context (activeBusinessId cookie
 * / x-business-id header). Entitlements are NOT granted here — only the webhook
 * (subscription.activated/charged) flips them, so a closed checkout window
 * can't leave a half-activated state.
 */
export async function POST(req: Request) {
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

    // The customer picks a billing duration (monthly/quarterly/6-month/yearly);
    // default to monthly for older clients that send no body.
    const body = await req.json().catch(() => ({}));
    const cycle: BillingCycle = isBillingCycle(body?.cycle) ? body.cycle : 'monthly';

    const activePlan = await getActivePlan();

    // Resolves the super-admin-configured price for the chosen cycle, creating a
    // matching Razorpay Plan on the fly if needed. Throws (caught below) if the
    // cycle isn't enabled.
    const duration = await ensureRazorpayPlanIdForCycle(cycle);
    if (!duration.razorpayPlanId) {
      return NextResponse.json(
        { error: 'Billing is not configured on this server' },
        { status: 503 }
      );
    }

    const rpSubscription = await razorpay.subscriptions.create({
      plan_id: duration.razorpayPlanId,
      customer_notify: 1,
      total_count: CYCLES[cycle].totalCount,
      notes: {
        // The webhook resolves the user AND the workspace from these notes.
        userId: ctx.userId,
        businessId: ctx.businessId,
        planType: activePlan.planType,
        billingCycle: cycle,
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
        planType: activePlan.planType,
        name: 'GrowwMatics AI',
        description: `${activePlan.displayName} — ₹${duration.priceInr} / ${CYCLES[cycle].label}`,
        prefill: {
          email: user?.email ?? undefined,
          contact: user?.phone ?? undefined,
        },
      },
    });
  } catch (error: any) {
    console.error('Checkout error:', error);
    // Razorpay's own error.error.description is already a clean, human
    // sentence when present ("The id provided does not exist", etc.) — only
    // fall back to the generic translator for everything else (Mongo,
    // network, unexpected shapes) rather than ever showing raw error.message.
    return NextResponse.json(
      { error: error?.error?.description || toFriendlyMessage(error) },
      { status: 500 }
    );
  }
}
