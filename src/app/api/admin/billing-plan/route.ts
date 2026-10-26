import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import BillingPlan from '@/models/BillingPlan';
import AdminActionLog from '@/models/AdminActionLog';
import { getClientIp } from '@/lib/rateLimit';
import {
  getActivePlan,
  PLAN_FALLBACK,
  isBillingCycle,
  saveAdminPlan,
  type AdminDurationInput,
} from '@/lib/billing/planCatalog';
import { getRazorpay, getRazorpayMode } from '@/lib/billing/razorpay';

/**
 * Super admin: the ONE sellable plan. GET returns it; PATCH edits price /
 * display name / description. A price change invalidates the stored Razorpay
 * Plan (amounts are immutable there); a fresh one is created lazily at the
 * first checkout for that duration. An unchanged price keeps its stored plan
 * id exactly as saved (id, price, test/live mode).
 * Existing subscribers keep paying their old price; the new amount applies
 * to new checkouts only.
 */

const MAX_PRICE_INR = 500000;

/** What a price change is audited as — the sellable terms only, never Razorpay ids. */
function auditView(plan: Awaited<ReturnType<typeof getActivePlan>>) {
  return {
    displayName: plan.displayName,
    priceInr: plan.priceInr,
    durations: plan.durations.map((d) => ({ cycle: d.cycle, priceInr: d.priceInr, enabled: d.enabled })),
  };
}

/** Every change to what customers pay goes to AdminActionLog with the old and new terms. */
async function auditPlanChange(req: Request, auth: { userId: string; user: any }, action: string, before: ReturnType<typeof auditView>, after: ReturnType<typeof auditView>) {
  try {
    await AdminActionLog.create({
      adminUserId: auth.userId,
      adminEmail: auth.user?.email ?? '',
      action,
      ip: getClientIp(req),
      metadata: { old: before, new: after },
    });
  } catch (e: any) {
    console.error('[admin/billing-plan] audit log write failed:', e?.message);
  }
}

async function planPayload() {
  const plan = await getActivePlan();
  return {
    ...plan,
    razorpayConfigured: Boolean(getRazorpay()),
    razorpayMode: getRazorpayMode(),
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
    return NextResponse.json({ error: 'Something went wrong on our end. Please try again, and contact support if this keeps happening.' }, { status: 500 });
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

    // Per-duration pricing. The whole set is replaced; the stored Razorpay plan
    // (id, price, mode) is kept for each unchanged price — merged at write time
    // by saveAdminPlan, so a plan id attached meanwhile is not lost.
    let durations: AdminDurationInput[] | undefined;
    if ('durations' in body) {
      if (!Array.isArray(body.durations)) {
        return NextResponse.json({ error: 'durations must be an array' }, { status: 400 });
      }
      const seen = new Set<string>();
      durations = [];
      for (const d of body.durations) {
        if (!isBillingCycle(d?.cycle) || seen.has(d.cycle)) {
          return NextResponse.json({ error: `Invalid or duplicate cycle: ${d?.cycle}` }, { status: 400 });
        }
        seen.add(d.cycle);
        const price = Math.round(Number(d.priceInr));
        if (!Number.isFinite(price) || price < 1 || price > MAX_PRICE_INR) {
          return NextResponse.json({ error: `Price for ${d.cycle} must be 1–${MAX_PRICE_INR}` }, { status: 400 });
        }
        durations.push({ cycle: d.cycle, priceInr: price, enabled: Boolean(d.enabled) });
      }
      // At least monthly must be enabled so there's always something to sell
      // (omitted cycles are saved disabled).
      if (!durations.some((d) => d.enabled)) {
        return NextResponse.json({ error: 'Enable at least one billing duration.' }, { status: 400 });
      }
    }

    if (Object.keys(update).length === 1 && !durations) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const before = auditView(await getActivePlan());
    if ((await saveAdminPlan({ fields: update, durations })) === 'conflict') {
      return NextResponse.json(
        { error: 'The plan was updated at the same moment. Please reload and save again.', code: 'PLAN_SAVE_CONFLICT' },
        { status: 409 }
      );
    }
    await auditPlanChange(req, auth, 'billing_plan.update', before, auditView(await getActivePlan()));

    // Razorpay plans for changed prices are created lazily at first checkout
    // (per duration), so a save never fails on a Razorpay error. Surface only a
    // config hint when keys are missing.
    let warning: string | undefined;
    if (('priceInr' in update || durations) && !getRazorpay()) {
      warning = 'Saved. Razorpay keys are not configured, so checkout is disabled until they are.';
    }

    return NextResponse.json({ success: true, data: await planPayload(), warning });
  } catch (err: any) {
    console.error('[billing-plan PATCH]', err);
    return NextResponse.json({ error: 'Something went wrong on our end. Please try again, and contact support if this keeps happening.' }, { status: 500 });
  }
}

// DELETE — reset the plan back to hardcoded defaults (removes the override).
export async function DELETE(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const before = auditView(await getActivePlan());
    await BillingPlan.deleteOne({ key: 'default' });
    await auditPlanChange(req, auth, 'billing_plan.reset', before, auditView(await getActivePlan()));
    return NextResponse.json({
      success: true,
      data: await planPayload(),
      message: `Plan reset to defaults (₹${PLAN_FALLBACK.priceInr}/month).`,
    });
  } catch (err: any) {
    console.error('[billing-plan DELETE]', err);
    return NextResponse.json({ error: 'Something went wrong on our end. Please try again, and contact support if this keeps happening.' }, { status: 500 });
  }
}
