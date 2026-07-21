import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import BillingPlan from '@/models/BillingPlan';
import {
  ensureRazorpayPlanId,
  getActivePlan,
  PLAN_FALLBACK,
} from '@/lib/billing/planCatalog';
import { getRazorpay } from '@/lib/billing/razorpay';

/**
 * Super admin: the ONE sellable plan. GET returns it; PATCH edits price /
 * display name / description. A price change invalidates the stored Razorpay
 * Plan (amounts are immutable there), so a fresh one is created immediately
 * when Razorpay is configured — otherwise lazily at first checkout.
 * Existing subscribers keep paying their old price; the new amount applies
 * to new checkouts only.
 */

const MAX_PRICE_INR = 500000;

async function planPayload() {
  const plan = await getActivePlan();
  return {
    ...plan,
    razorpayConfigured: Boolean(getRazorpay()),
    razorpayPlanReady: Boolean(plan.razorpayPlanId),
  };
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    return NextResponse.json({ success: true, data: await planPayload() });
  } catch (err: any) {
    console.error('[billing-plan GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const body = await req.json();
    const update: Record<string, any> = { updatedBy: 'super-admin' };

    if ('priceInr' in body) {
      const price = Number(body.priceInr);
      if (!Number.isFinite(price) || price < 1 || price > MAX_PRICE_INR) {
        return NextResponse.json(
          { error: `priceInr must be between 1 and ${MAX_PRICE_INR}` },
          { status: 400 }
        );
      }
      update.priceInr = Math.round(price);
    }

    if ('displayName' in body) {
      const name = String(body.displayName ?? '').trim();
      if (!name || name.length > 60) {
        return NextResponse.json(
          { error: 'displayName must be 1–60 characters' },
          { status: 400 }
        );
      }
      update.displayName = name;
    }

    if ('description' in body) {
      const description = String(body.description ?? '').trim();
      if (description.length > 300) {
        return NextResponse.json(
          { error: 'description must be at most 300 characters' },
          { status: 400 }
        );
      }
      update.description = description;
    }

    if (Object.keys(update).length === 1) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Fill required fields on first save so the upsert can't fail validation.
    const current = await getActivePlan();
    await BillingPlan.findOneAndUpdate(
      { key: 'default' },
      {
        $set: {
          displayName: current.displayName,
          description: current.description,
          priceInr: current.priceInr,
          ...update,
        },
      },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );

    // A new price needs a new Razorpay Plan; create it now so problems
    // surface to the admin instead of to a paying customer at checkout.
    let warning: string | undefined;
    if ('priceInr' in update) {
      if (getRazorpay()) {
        try {
          await ensureRazorpayPlanId();
        } catch (err: any) {
          console.error('[billing-plan] Razorpay plan creation failed:', err);
          warning =
            'Price saved, but creating the Razorpay plan failed — checkout will retry automatically. ' +
            (err?.error?.description || err?.message || '');
        }
      } else {
        warning = 'Price saved. Razorpay keys are not configured, so checkout is disabled until they are.';
      }
    }

    return NextResponse.json({ success: true, data: await planPayload(), warning });
  } catch (err: any) {
    console.error('[billing-plan PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE — reset the plan back to hardcoded defaults (removes the override).
export async function DELETE() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    await BillingPlan.deleteOne({ key: 'default' });
    return NextResponse.json({
      success: true,
      data: await planPayload(),
      message: `Plan reset to defaults (₹${PLAN_FALLBACK.priceInr}/month).`,
    });
  } catch (err: any) {
    console.error('[billing-plan DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
