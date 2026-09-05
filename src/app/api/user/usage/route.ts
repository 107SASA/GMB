import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import User from '@/models/User';
import UserLimitOverride from '@/models/UserLimitOverride';
import PlanConfig from '@/models/PlanConfig';
import SubscriptionUsage from '@/models/SubscriptionUsage';
import AIUsageLog from '@/models/AIUsageLog';
import Post from '@/models/Post';
import { getPlanDefaults, type PlanLimits } from '@/lib/planDefaults';

async function getPlanLimits(planName: string): Promise<PlanLimits> {
  if (planName === 'Enterprise') planName = 'Pro'; // legacy paid tier → THE paid plan
  try {
    const config = await PlanConfig.findOne({ plan: planName }).lean() as any;
    if (config) {
      return {
        maxAuditsPerBusiness:      config.maxAuditsPerBusiness,
        maxPostsPerMonth:          config.maxPostsPerMonth,
        postLimitFrequency:        config.postLimitFrequency ?? 'monthly',
        maxWhatsAppMessagesPerDay: config.maxWhatsAppMessagesPerDay,
        reviewRequestCooldownDays: config.reviewRequestCooldownDays,
        maxAIGenerations:          config.maxAIGenerations,
      };
    }
  } catch { /* fall through */ }
  return getPlanDefaults(planName);
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
    // whatsappMessagesUsed is bucketed by DAY, not month (see the matching
    // comment in lib/featureGating.ts) — maxWhatsAppMessagesPerDay is a
    // daily cap, so this reads the same day-keyed document that check/
    // incrementUsage actually write to, not the month-keyed one below.
    const day = new Date().toISOString().slice(0, 10);

    const [user, override, subUsage, whatsappUsage, aiCount] = await Promise.all([
      User.findById(ctx.userId).select('subscriptionPlan fullName email').lean() as any,
      UserLimitOverride.findOne({ userId: ctx.userId }).lean() as any,
      SubscriptionUsage.findOne({ businessId: ctx.businessId, month }).lean() as any,
      SubscriptionUsage.findOne({ businessId: ctx.businessId, month: day }).select('whatsappMessagesUsed').lean() as any,
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
      // Plan-level policy — never comes from a per-user override.
      postLimitFrequency:        planLimits.postLimitFrequency,
      maxWhatsAppMessagesPerDay: override?.maxWhatsAppMessagesPerDay ?? planLimits.maxWhatsAppMessagesPerDay,
      reviewRequestCooldownDays: override?.reviewRequestCooldownDays ?? planLimits.reviewRequestCooldownDays,
      maxAIGenerations:          override?.maxAIGenerations          ?? planLimits.maxAIGenerations,
    };

    // SubscriptionUsage only buckets postsUsed by month — for a weekly-cap
    // plan, count actual posts since Monday instead so the number shown
    // matches what checkUsageLimit() enforces (see lib/featureGating.ts).
    let postsUsed = subUsage?.postsUsed ?? 0;
    if (limits.postLimitFrequency === 'weekly') {
      const now = new Date();
      const day = now.getUTCDay();
      const startOfWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day === 0 ? 6 : day - 1)));
      postsUsed = await Post.countDocuments({ businessId: ctx.businessId, createdAt: { $gte: startOfWeek } });
    }

    const usage = {
      auditsUsed:         subUsage?.auditsUsed            ?? 0,
      postsUsed,
      whatsappUsed:       whatsappUsage?.whatsappMessagesUsed ?? 0,
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
    return NextResponse.json({ error: 'Something went wrong on our end. Please try again, and contact support if this keeps happening.' }, { status: 500 });
  }
}
