import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { isQaTestingMode } from '@/lib/testingMode';

export const dynamic = 'force-dynamic';

/**
 * DEV / QA ONLY — simulate a verified Razorpay payment for a test lead so the
 * customer-activation flow (stop nurture, cancel pending sales actions,
 * activate exactly once, invoice + welcome WhatsApp, hand to In-House) can be
 * tested end-to-end without real Razorpay production credentials.
 *
 * HARD GATED on QA_TESTING_MODE=true (absent/false in production — see
 * lib/testingMode.ts). Returns 404 otherwise, so this route is effectively
 * invisible in prod.
 *
 * It calls the SAME runCustomerActivationSequence the real webhook calls, and
 * the SAME activatePlan entitlement flip, so idempotency, ownership, and the
 * message flow are exercised exactly as in production. It does NOT touch
 * Razorpay and creates no ProcessedWebhookEvent row — call it twice to prove
 * activation is idempotent (currentStage === 'CUSTOMER' guard).
 *
 * Body: { userId?: string, businessId?: string, phone?: string,
 *         paymentId?: string, amount?: number, currency?: string }
 * Provide either userId (+ optional businessId) OR phone (a test lead's
 * phone under tenantId 'gmbboost-internal', from which the shadow user is
 * resolved).
 */
export async function POST(req: Request) {
  if (!isQaTestingMode()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    let userId: string | undefined = body.userId;
    let businessId: string | undefined = body.businessId;

    if (!userId && body.phone) {
      const { normalizePhoneE164 } = await import('@/lib/phone');
      const { default: User } = await import('@/models/User');
      const { default: Business } = await import('@/models/Business');
      const norm = normalizePhoneE164(String(body.phone)) || String(body.phone);
      const user = await User.findOne({ phone: norm }).select('_id').lean() as any;
      if (!user) {
        return NextResponse.json(
          { error: `No User with phone ${norm}. Create a shadow user first (testkit "pay" command seeds one).` },
          { status: 400 }
        );
      }
      userId = String(user._id);
      if (!businessId) {
        const biz = await Business.findOne({ userId: user._id }).select('_id').lean() as any;
        if (biz) businessId = String(biz._id);
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Provide userId or phone.' }, { status: 400 });
    }

    // Mirror the real webhook: entitlement flip THEN the activation sequence.
    const { activatePlan } = await import('@/lib/billing/applyEntitlements');
    await activatePlan(userId, { razorpaySubscriptionId: `sub_SIMULATED_${Date.now()}` });

    const { runCustomerActivationSequence } = await import('@/services/billing/customerActivation');
    await runCustomerActivationSequence(userId, businessId ?? null, {
      paymentId: body.paymentId || `pay_SIMULATED_${Date.now()}`,
      amount: typeof body.amount === 'number' ? body.amount : 199900,
      currency: body.currency || 'INR',
    });

    return NextResponse.json({
      success: true,
      simulated: true,
      userId,
      businessId: businessId ?? null,
      note: 'Call again to verify idempotency — the second call should be a no-op (currentStage CUSTOMER guard).',
    });
  } catch (error: any) {
    console.error('[dev/simulate-payment] failed:', error?.message);
    return NextResponse.json({ error: error?.message || 'simulation failed' }, { status: 500 });
  }
}
