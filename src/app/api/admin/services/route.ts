import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import ServiceAccount from '@/models/ServiceAccount';
import { isServiceKey, monthlyPlanCost, runServiceChecks, serviceLimitKeys } from '@/lib/serviceMonitor';

export const dynamic = 'force-dynamic';

/** Runs every service check live and returns the full report. */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const services = await runServiceChecks();
    const totals: Record<string, { plans: number; usage: number }> = {};
    for (const s of services) {
      const planCur = s.plan.costCurrency;
      totals[planCur] ??= { plans: 0, usage: 0 };
      totals[planCur].plans += monthlyPlanCost(s);
      if (s.spend) {
        totals[s.spend.currency] ??= { plans: 0, usage: 0 };
        totals[s.spend.currency].usage += s.spend.amount;
      }
    }
    return NextResponse.json({ success: true, data: { services, totals, alertEmail: Boolean(process.env.ADMIN_EMAIL), fetchedAt: new Date().toISOString() } });
  } catch (error: any) {
    console.error('[admin/services] check failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to check services' }, { status: 500 });
  }
}

const CYCLES = ['free', 'monthly', 'yearly', 'prepaid', 'one_time', 'usage'];

/** Saves the hand-entered plan details for one service. */
export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const key = String(body?.key || '');
  if (!isServiceKey(key)) return NextResponse.json({ success: false, error: 'Unknown service' }, { status: 400 });

  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (typeof body.planName === 'string') set.planName = body.planName.slice(0, 120);
  if (typeof body.notes === 'string') set.notes = body.notes.slice(0, 1000);
  if (typeof body.alertsMuted === 'boolean') set.alertsMuted = body.alertsMuted;
  if (CYCLES.includes(body.billingCycle)) set.billingCycle = body.billingCycle;
  if (body.costCurrency === 'USD' || body.costCurrency === 'INR') set.costCurrency = body.costCurrency;
  if ('costAmount' in body) {
    const n = Number(body.costAmount);
    if (body.costAmount === null || body.costAmount === '') unset.costAmount = 1;
    else if (Number.isFinite(n) && n >= 0) set.costAmount = n;
  }
  if ('renewalDate' in body) {
    const d = body.renewalDate ? new Date(body.renewalDate) : null;
    if (!d) unset.renewalDate = 1;
    else if (!Number.isNaN(d.getTime())) set.renewalDate = d;
  }
  if (body.limits && typeof body.limits === 'object') {
    for (const k of serviceLimitKeys(key)) {
      if (!(k in body.limits)) continue;
      const v = body.limits[k];
      if (v === null || v === '') unset[`limits.${k}`] = 1;
      else if (Number.isFinite(Number(v)) && Number(v) >= 0) set[`limits.${k}`] = Number(v);
    }
  }

  await dbConnect();
  await ServiceAccount.updateOne(
    { key },
    { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}), $setOnInsert: { key } },
    { upsert: true }
  );
  return NextResponse.json({ success: true });
}
