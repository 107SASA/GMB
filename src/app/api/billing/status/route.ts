import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import { requireClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Current subscription for the signed-in user — the same block
 * /api/auth/me returns, plus billing-specific fields for the web UI.
 */
export async function GET() {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();

  const subscription = await Subscription.findOne({ userId: auth.userId })
    .select('planType billingStatus trialStatus modules razorpaySubscriptionId currentPeriodEnd')
    .lean() as any;

  if (!subscription) {
    return NextResponse.json({
      success: true,
      subscription: {
        planType: 'Free',
        billingStatus: 'Trialing',
        trialStatus: { isActive: false },
        modules: {},
        hasPaymentMethod: false,
        currentPeriodEnd: null,
      },
    });
  }

  return NextResponse.json({
    success: true,
    subscription: {
      planType: subscription.planType,
      billingStatus: subscription.billingStatus,
      trialStatus: subscription.trialStatus,
      modules: subscription.modules,
      hasPaymentMethod: Boolean(subscription.razorpaySubscriptionId),
      currentPeriodEnd: subscription.currentPeriodEnd ?? null,
    },
  });
}
