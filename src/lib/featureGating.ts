import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import UserLimitOverride from '@/models/UserLimitOverride';
import SubscriptionUsage from '@/models/SubscriptionUsage';
import AIUsageLog from '@/models/AIUsageLog';
import PlanConfig from '@/models/PlanConfig';
import { getPlanDefaults, type PlanLimits } from '@/lib/planDefaults';

async function getPlanLimitsFromDB(planName: string): Promise<PlanLimits> {
  if (planName === 'Enterprise') planName = 'Pro'; // legacy paid tier → THE paid plan
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
  } catch { /* fall through to hardcoded */ }
  return getPlanDefaults(planName);
}

async function resolveUserLimits(
  userId: string | mongoose.Types.ObjectId,
  planName: string
): Promise<PlanLimits> {
  const [planLimits, override] = await Promise.all([
    getPlanLimitsFromDB(planName),
    UserLimitOverride.findOne({ userId }).lean() as any,
  ]);

  if (!override) return planLimits;

  return {
    maxAuditsPerBusiness:      override.maxAuditsPerBusiness      ?? planLimits.maxAuditsPerBusiness,
    maxPostsPerMonth:          override.maxPostsPerMonth          ?? planLimits.maxPostsPerMonth,
    maxWhatsAppMessagesPerDay: override.maxWhatsAppMessagesPerDay ?? planLimits.maxWhatsAppMessagesPerDay,
    reviewRequestCooldownDays: override.reviewRequestCooldownDays ?? planLimits.reviewRequestCooldownDays,
    maxAIGenerations:          override.maxAIGenerations          ?? planLimits.maxAIGenerations,
  };
}

function metricLabel(metric: string): string {
  switch (metric) {
    case 'posts':           return 'post generations';
    case 'audits':          return 'audit reports';
    case 'aiGenerations':   return 'AI generations';
    case 'whatsappMessages':return 'WhatsApp messages';
    default:                return 'actions';
  }
}

export type UsageMetric = 'posts' | 'audits' | 'aiGenerations' | 'whatsappMessages';

export async function checkUsageLimit(
  userId: string | mongoose.Types.ObjectId,
  businessId: string | mongoose.Types.ObjectId,
  metric: UsageMetric,
  amount: number = 1
): Promise<{ allowed: boolean; reason?: string; code?: string; limit?: number; used?: number }> {
  await dbConnect();

  const user = await User.findById(userId).select('subscriptionPlan').lean() as any;
  const planName = user?.subscriptionPlan || 'Free';

  const limits = await resolveUserLimits(userId, planName);
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM

  let limit = -1;
  let currentUsage = 0;

  switch (metric) {
    case 'audits': {
      limit = limits.maxAuditsPerBusiness;
      const usage = await SubscriptionUsage.findOne({ businessId, month }).lean() as any;
      currentUsage = usage?.auditsUsed ?? 0;
      break;
    }
    case 'posts': {
      limit = limits.maxPostsPerMonth;
      const usage = await SubscriptionUsage.findOne({ businessId, month }).lean() as any;
      currentUsage = usage?.postsUsed ?? 0;
      break;
    }
    case 'aiGenerations': {
      limit = limits.maxAIGenerations;
      const startOfMonth = new Date(`${month}-01T00:00:00.000Z`);
      const endOfMonth = new Date(startOfMonth);
      endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1);
      currentUsage = await AIUsageLog.countDocuments({
        userId: userId.toString(),
        status: 'success',
        createdAt: { $gte: startOfMonth, $lt: endOfMonth },
      });
      break;
    }
    case 'whatsappMessages': {
      limit = limits.maxWhatsAppMessagesPerDay;
      const usage = await SubscriptionUsage.findOne({ businessId, month }).lean() as any;
      currentUsage = usage?.whatsappMessagesUsed ?? 0;
      break;
    }
    default:
      return { allowed: false, reason: 'Unknown metric.' };
  }

  if (limit === -1) return { allowed: true, limit, used: currentUsage };

  if (currentUsage + amount > limit) {
    return {
      allowed: false,
      reason: `You are out of your ${metricLabel(metric)} limit (${currentUsage}/${limit} used). Upgrade your plan to get more.`,
      code: 'UPGRADE_REQUIRED',
      limit,
      used: currentUsage,
    };
  }

  return { allowed: true, limit, used: currentUsage };
}

export async function incrementUsage(
  businessId: string | mongoose.Types.ObjectId,
  metric: UsageMetric,
  amount: number = 1
) {
  const month = new Date().toISOString().slice(0, 7);

  const updateObj: Record<string, number> = {};
  if (metric === 'posts')            updateObj.postsUsed            = amount;
  else if (metric === 'audits')      updateObj.auditsUsed           = amount;
  else if (metric === 'whatsappMessages') updateObj.whatsappMessagesUsed = amount;
  // aiGenerations are tracked implicitly via AIUsageLog — no SubscriptionUsage counter

  if (Object.keys(updateObj).length === 0) return;

  await SubscriptionUsage.findOneAndUpdate(
    { businessId, month },
    { $inc: updateObj },
    { upsert: true }
  );
}
