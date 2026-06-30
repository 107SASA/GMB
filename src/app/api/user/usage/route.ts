import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import User from '@/models/User';
import UserLimitOverride from '@/models/UserLimitOverride';
import PlanConfig from '@/models/PlanConfig';
import SubscriptionUsage from '@/models/SubscriptionUsage';
import AIUsageLog from '@/models/AIUsageLog';
import { PLAN_DEFAULTS, FALLBACK_LIMITS, type PlanLimits } from '@/lib/planDefaults';

async function getPlanLimits(planName: string): Promise<PlanLimits> {
  try {
    const config = await PlanConfig.findOne({ plan: planName }).lean() as any;
    if (config) {
      return {
        maxAuditsPerBusiness:      config.maxAuditsPerBusiness,
        maxPostsPerMonth:          config.maxPostsPerMonth,
        maxWhatsAppMessagesPerDay: config.maxWhatsAppMessagesPerDay,
        reviewRequestCooldownDays: config.reviewRequestCooldownDays,
        maxAIGenerations:          config.maxAIGenerations,
      };
    }
  } catch { /* fall through */ }
  return PLAN_DEFAULTS[planName] ?? FALLBACK_LIMITS;
}

export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const month = new Date().toISOString().slice(0, 7);
    const startOfMonth = new Date(`${month}-01T00:00:00.000Z`);
    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1);

    const [user, override, subUsage, aiCount] = await Promise.all([
      User.findById(ctx.userId).select('subscriptionPlan fullName email').lean() as any,
      UserLimitOverride.findOne({ userId: ctx.userId }).lean() as any,
      SubscriptionUsage.findOne({ businessId: ctx.businessId, month }).lean() as any,
      AIUsageLog.countDocuments({
        userId: ctx.userId,
        status: 'success',
        createdAt: { $gte: startOfMonth, $lt: endOfMonth },
      }),
    ]);

    const planName = user?.subscriptionPlan || 'Free';
    const planLimits = await getPlanLimits(planName);

    // Apply per-user overrides
    const limits: PlanLimits = {
      maxAuditsPerBusiness:      override?.maxAuditsPerBusiness      ?? planLimits.maxAuditsPerBusiness,
      maxPostsPerMonth:          override?.maxPostsPerMonth          ?? planLimits.maxPostsPerMonth,
      maxWhatsAppMessagesPerDay: override?.maxWhatsAppMessagesPerDay ?? planLimits.maxWhatsAppMessagesPerDay,
      reviewRequestCooldownDays: override?.reviewRequestCooldownDays ?? planLimits.reviewRequestCooldownDays,
      maxAIGenerations:          override?.maxAIGenerations          ?? planLimits.maxAIGenerations,
    };

    const usage = {
      auditsUsed:         subUsage?.auditsUsed            ?? 0,
      postsUsed:          subUsage?.postsUsed             ?? 0,
      whatsappUsed:       subUsage?.whatsappMessagesUsed  ?? 0,
      aiGenerationsUsed:  aiCount,
    };

    return NextResponse.json({
      success: true,
      data: {
        plan: planName,
        month,
        limits,
        usage,
        hasOverride: !!override,
      },
    });
  } catch (err: any) {
    console.error('[user/usage GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
