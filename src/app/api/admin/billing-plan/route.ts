import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import BillingPlan from '@/models/BillingPlan';
import {
  getActivePlan,
  PLAN_FALLBACK,
  CYCLE_ORDER,
  isBillingCycle,
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

    // Editable feature bullets (shown on the pricing card / paywall).
    if ('features' in body) {
      if (!Array.isArray(body.features)) {
        return NextResponse.json({ error: 'features must be an array of strings' }, { status: 400 });
      }
      const features = body.features
        .map((f: unknown) => String(f ?? '').trim())
        .filter(Boolean)
        .slice(0, 12);
      if (features.some((f: string) => f.length > 120)) {
        return NextResponse.json({ error: 'each feature must be at most 120 characters' }, { status: 400 });
      }
      update.features = features;
    }

    // Per-duration pricing. The whole set is replaced; Razorpay ids for
    // unchanged prices are preserved (getActivePlan invalidates mismatches).
    if ('durations' in body) {
      if (!Array.isArray(body.durations)) {
        return NextResponse.json({ error: 'durations must be an array' }, { status: 400 });
      }
      const current = await getActivePlan();
      const existing = new Map(current.durations.map((d) => [d.cycle, d]));
      const seen = new Set<string>();
      const out: any[] = [];
      for (const d of body.durations) {
        if (!isBillingCycle(d?.cycle) || seen.has(d.cycle)) {
          return NextResponse.json({ error: `Invalid or duplicate cycle: ${d?.cycle}` }, { status: 400 });
        }
        seen.add(d.cycle);
        const price = Math.round(Number(d.priceInr));
        if (!Number.isFinite(price) || price < 1 || price > MAX_PRICE_INR) {
          return NextResponse.json({ error: `Price for ${d.cycle} must be 1–${MAX_PRICE_INR}` }, { status: 400 });
        }
        const prev = existing.get(d.cycle);
        // Preserve the Razorpay id only when the price is unchanged.
        const keepRp = prev?.razorpayPlanId && prev.priceInr === price;
        out.push({
          cycle: d.cycle,
          priceInr: price,
          enabled: Boolean(d.enabled),
          ...(keepRp ? { razorpayPlanId: prev!.razorpayPlanId, razorpayPlanPriceInr: price } : {}),
        });
      }
      // Ensure all four cycles exist (disabled if omitted) so the array is complete.
      for (const cycle of CYCLE_ORDER) {
        if (!seen.has(cycle)) {
          const prev = existing.get(cycle)!;
          out.push({ cycle, priceInr: prev.priceInr, enabled: false });
        }
      }
      // At least monthly must be enabled so there's always something to sell.
      if (!out.some((d) => d.enabled)) {
        return NextResponse.json({ error: 'Enable at least one billing duration.' }, { status: 400 });
      }
      update.durations = out;
      // Keep the legacy monthly price in sync for back-compat readers.
      const monthly = out.find((d) => d.cycle === 'monthly');
      if (monthly) update.priceInr = monthly.priceInr;
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

    // Razorpay plans for changed prices are created lazily at first checkout
    // (per duration), so a save never fails on a Razorpay error. Surface only a
    // config hint when keys are missing.
    let warning: string | undefined;
    if (('priceInr' in update || 'durations' in update) && !getRazorpay()) {
      warning = 'Saved. Razorpay keys are not configured, so checkout is disabled until they are.';
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
