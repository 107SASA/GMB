import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import User from '@/models/User';
import UserLimitOverride from '@/models/UserLimitOverride';
import { getPlanDefaults, resolveEffectiveLimits } from '@/lib/planDefaults';

// GET — fetch current override + plan defaults for a single user
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const { userId } = await params;

  try {
    await dbConnect();

    const user = await User.findById(userId).select('fullName email subscriptionPlan').lean() as any;
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const plan     = user.subscriptionPlan || 'Free';
    const override = await UserLimitOverride.findOne({ userId }).lean() as any;

    const effective = resolveEffectiveLimits(plan, {
      maxAuditsPerBusiness:      override?.maxAuditsPerBusiness,
      maxPostsPerMonth:          override?.maxPostsPerMonth,
      maxWhatsAppMessagesPerDay: override?.maxWhatsAppMessagesPerDay,
      reviewRequestCooldownDays: override?.reviewRequestCooldownDays,
      maxAIGenerations:          override?.maxAIGenerations,
    });

    return NextResponse.json({
      success: true,
      data: {
        userId,
        fullName: user.fullName,
        email:    user.email,
        plan,
        planDefaults: getPlanDefaults(plan),
        override: {
          maxAuditsPerBusiness:      override?.maxAuditsPerBusiness      ?? null,
          maxPostsPerMonth:          override?.maxPostsPerMonth          ?? null,
          maxWhatsAppMessagesPerDay: override?.maxWhatsAppMessagesPerDay ?? null,
          reviewRequestCooldownDays: override?.reviewRequestCooldownDays ?? null,
          maxAIGenerations:          override?.maxAIGenerations          ?? null,
          adminNotes:                override?.adminNotes                ?? '',
        },
        effective,
      },
    });
  } catch (err: any) {
    console.error('[usage-limits GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH — upsert per-user limit overrides
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const { userId } = await params;

  try {
    await dbConnect();

    const user = await User.findById(userId).select('fullName subscriptionPlan').lean() as any;
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const body = await req.json();

    // Only accept known fields; null means "reset to plan default"
    const allowed = [
      'maxAuditsPerBusiness',
      'maxPostsPerMonth',
      'maxWhatsAppMessagesPerDay',
      'reviewRequestCooldownDays',
      'maxAIGenerations',
      'adminNotes',
    ] as const;

    const update: Record<string, any> = { updatedBy: 'super-admin' };
    for (const key of allowed) {
      if (key in body) {
        // Validate numbers; allow null to clear override
        const val = body[key];
        if (key === 'adminNotes') {
          update[key] = String(val ?? '').slice(0, 500);
        } else {
          if (val === null || val === undefined) {
            update[key] = null;
          } else {
            const n = Number(val);
            if (!isFinite(n) || n < 0) {
              return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 });
            }
            update[key] = Math.round(n);
          }
        }
      }
    }

    const override = await UserLimitOverride.findOneAndUpdate(
      { userId },
      { $set: update },
      { upsert: true, new: true }
    );

    const plan      = user.subscriptionPlan || 'Free';
    const effective = resolveEffectiveLimits(plan, {
      maxAuditsPerBusiness:      override.maxAuditsPerBusiness,
      maxPostsPerMonth:          override.maxPostsPerMonth,
      maxWhatsAppMessagesPerDay: override.maxWhatsAppMessagesPerDay,
      reviewRequestCooldownDays: override.reviewRequestCooldownDays,
      maxAIGenerations:          override.maxAIGenerations,
    });

    return NextResponse.json({ success: true, effective });
  } catch (err: any) {
    console.error('[usage-limits PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
