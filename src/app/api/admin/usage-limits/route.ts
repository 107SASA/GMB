import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import User from '@/models/User';
import Business from '@/models/Business';
import UserLimitOverride from '@/models/UserLimitOverride';
import { resolveEffectiveLimits } from '@/lib/planDefaults';

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const page   = Math.max(1, parseInt(searchParams.get('page')  || '1'));
    const limit  = Math.min(50, parseInt(searchParams.get('limit') || '20'));
    const search = searchParams.get('search') || '';
    const plan   = searchParams.get('plan')   || 'all';
    const skip   = (page - 1) * limit;

    const query: any = { role: { $ne: 'SUPER_ADMIN' } };
    if (search.trim()) {
      query.$or = [
        { fullName: { $regex: search.trim(), $options: 'i' } },
        { email:    { $regex: search.trim(), $options: 'i' } },
      ];
    }
    if (plan !== 'all') query.subscriptionPlan = plan;

    const [users, total] = await Promise.all([
      User.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('fullName email subscriptionPlan')
        .lean(),
      User.countDocuments(query),
    ]);

    const userIds = users.map((u: any) => u._id);

    const [businesses, overrides] = await Promise.all([
      Business.find({ userId: { $in: userIds } })
        .select('userId name category')
        .lean(),
      UserLimitOverride.find({ userId: { $in: userIds } }).lean(),
    ]);

    const businessMap: Record<string, any> = {};
    businesses.forEach((b: any) => {
      if (b.userId) businessMap[b.userId.toString()] = b;
    });

    const overrideMap: Record<string, any> = {};
    overrides.forEach((o: any) => {
      overrideMap[o.userId.toString()] = o;
    });

    const rows = users.map((u: any) => {
      const uid      = u._id.toString();
      const override = overrideMap[uid] ?? {};
      const plan     = u.subscriptionPlan || 'Free';
      const effective = resolveEffectiveLimits(plan, {
        maxAuditsPerBusiness:      override.maxAuditsPerBusiness,
        maxPostsPerMonth:          override.maxPostsPerMonth,
        maxWhatsAppMessagesPerDay: override.maxWhatsAppMessagesPerDay,
        reviewRequestCooldownDays: override.reviewRequestCooldownDays,
        maxAIGenerations:          override.maxAIGenerations,
      });

      return {
        userId:   uid,
        fullName: u.fullName,
        email:    u.email,
        plan,
        business: businessMap[uid]
          ? { name: businessMap[uid].name, category: businessMap[uid].category }
          : null,
        effective,
        override: {
          maxAuditsPerBusiness:      override.maxAuditsPerBusiness      ?? null,
          maxPostsPerMonth:          override.maxPostsPerMonth          ?? null,
          maxWhatsAppMessagesPerDay: override.maxWhatsAppMessagesPerDay ?? null,
          reviewRequestCooldownDays: override.reviewRequestCooldownDays ?? null,
          maxAIGenerations:          override.maxAIGenerations          ?? null,
          adminNotes:                override.adminNotes                ?? '',
        },
        hasOverride: effective.overriddenFields.length > 0,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        rows,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error('[admin/usage-limits GET]', err);
    return NextResponse.json({ success: false, error: 'Failed to fetch usage limits' }, { status: 500 });
  }
}
