import mongoose from 'mongoose';
import Subscription from '@/models/Subscription';
import Plan from '@/models/Plan';
import SubscriptionUsage from '@/models/SubscriptionUsage';

export async function getActivePlan(businessId: string | mongoose.Types.ObjectId) {
  const sub = await Subscription.findOne({ 
    businessId, 
    status: { $in: ['active', 'trialing'] } 
  }).populate('planId');
  
  if (!sub || !sub.planId) {
    return null;
  }
  return sub.planId as any; // Returns the populated Plan document
}

export async function checkPlanAccess(businessId: string | mongoose.Types.ObjectId, featureName: string): Promise<boolean> {
  const plan = await getActivePlan(businessId);
  if (!plan) return false;
  
  // Example features checking
  return plan.features.some((f: string) => f.toLowerCase().includes(featureName.toLowerCase()));
}

export type UsageMetric = 'posts' | 'audits' | 'businesses' | 'reviewRequests' | 'whatsappMessages';

export async function checkUsageLimit(
  businessId: string | mongoose.Types.ObjectId, 
  metric: UsageMetric, 
  amount: number = 1
): Promise<{ allowed: boolean; reason?: string; limit?: number; used?: number }> {
  const plan = await getActivePlan(businessId);
  if (!plan) return { allowed: false, reason: 'No active plan found.' };

  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  
  const usage = await SubscriptionUsage.findOneAndUpdate(
    { businessId, month },
    { $setOnInsert: { businessId, month } },
    { upsert: true, new: true }
  );

  let limit = -1;
  let currentUsage = 0;

  switch (metric) {
    case 'posts':
      limit = plan.maxPosts;
      currentUsage = usage.postsUsed;
      break;
    case 'audits':
      limit = plan.maxAudits;
      currentUsage = usage.auditsUsed;
      break;
    case 'businesses':
      limit = plan.maxBusinesses;
      currentUsage = usage.businessesUsed;
      break;
    case 'reviewRequests':
      // Only Pro/Agency have unlimited, Growth has basic.
      limit = plan.name.includes('Pro') || plan.name.includes('Agency') ? -1 : 50; 
      currentUsage = usage.reviewRequestsUsed;
      break;
    case 'whatsappMessages':
      limit = plan.name.includes('Pro') || plan.name.includes('Agency') ? -1 : 0; // Only Pro+
      currentUsage = usage.whatsappMessagesUsed;
      break;
    default:
      return { allowed: false, reason: 'Unknown metric.' };
  }

  if (limit === -1) {
    return { allowed: true, limit, used: currentUsage };
  }

  if (currentUsage + amount > limit) {
    return { allowed: false, reason: `Plan limit of ${limit} ${metric} exceeded.`, limit, used: currentUsage };
  }

  return { allowed: true, limit, used: currentUsage };
}

export async function incrementUsage(
  businessId: string | mongoose.Types.ObjectId,
  metric: UsageMetric,
  amount: number = 1
) {
  const month = new Date().toISOString().slice(0, 7);
  
  const updateObj: any = {};
  if (metric === 'posts') updateObj.postsUsed = amount;
  else if (metric === 'audits') updateObj.auditsUsed = amount;
  else if (metric === 'businesses') updateObj.businessesUsed = amount;
  else if (metric === 'reviewRequests') updateObj.reviewRequestsUsed = amount;
  else if (metric === 'whatsappMessages') updateObj.whatsappMessagesUsed = amount;

  await SubscriptionUsage.findOneAndUpdate(
    { businessId, month },
    { $inc: updateObj },
    { upsert: true }
  );
}
