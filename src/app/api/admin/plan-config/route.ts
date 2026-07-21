import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import PlanConfig from '@/models/PlanConfig';
import { PLAN_DEFAULTS, type PlanLimits } from '@/lib/planDefaults';

// Single-plan model: Free (trial/unpaid) + Pro (THE paid plan).
const PLAN_NAMES = ['Free', 'Pro'] as const;

const LIMIT_KEYS: (keyof PlanLimits)[] = [
  'maxAuditsPerBusiness',
  'maxPostsPerMonth',
  'maxWhatsAppMessagesPerDay',
  'reviewRequestCooldownDays',
  'maxAIGenerations',
];

// GET — returns all plan configs, falling back to hardcoded defaults for any not in DB
export async function GET(_req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const configs = await PlanConfig.find({ plan: { $in: PLAN_NAMES } }).lean() as any[];
    const configMap: Record<string, any> = {};
    configs.forEach(c => { configMap[c.plan] = c; });

    const result = PLAN_NAMES.map(plan => {
      const db = configMap[plan];
      const hc = PLAN_DEFAULTS[plan];
      return {
        plan,
        maxAuditsPerBusiness:      db?.maxAuditsPerBusiness      ?? hc.maxAuditsPerBusiness,
        maxPostsPerMonth:          db?.maxPostsPerMonth          ?? hc.maxPostsPerMonth,
        maxWhatsAppMessagesPerDay: db?.maxWhatsAppMessagesPerDay ?? hc.maxWhatsAppMessagesPerDay,
        reviewRequestCooldownDays: db?.reviewRequestCooldownDays ?? hc.reviewRequestCooldownDays,
        maxAIGenerations:          db?.maxAIGenerations          ?? hc.maxAIGenerations,
        isCustom: !!db,
        updatedAt: db?.updatedAt ?? null,
      };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[plan-config GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH — upsert a single plan config by plan name
export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const body = await req.json();
    const { plan, ...rest } = body;

    if (!PLAN_NAMES.includes(plan)) {
      return NextResponse.json({ error: `Invalid plan name. Allowed: ${PLAN_NAMES.join(', ')}` }, { status: 400 });
    }

    const update: Record<string, any> = { updatedBy: 'super-admin' };
    for (const key of LIMIT_KEYS) {
      if (key in rest) {
        const val = Number(rest[key]);
        if (!isFinite(val) || val < 0) {
          return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 });
        }
        update[key] = Math.round(val);
      }
    }

    if (Object.keys(update).length === 1) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const config = await PlanConfig.findOneAndUpdate(
      { plan },
      { $set: update },
      { upsert: true, new: true }
    );

    return NextResponse.json({ success: true, data: config });
  } catch (err: any) {
    console.error('[plan-config PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE — reset a plan back to hardcoded defaults by removing the DB override
export async function DELETE(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const { plan } = await req.json();
    if (!PLAN_NAMES.includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan name' }, { status: 400 });
    }

    await PlanConfig.deleteOne({ plan });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[plan-config DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
