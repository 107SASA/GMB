import dbConnect from '@/lib/mongodb';
import SeoPlan from '@/models/SeoPlan';
import GBPToken from '@/models/GBPToken';
import { createChange } from '@/services/gbp/changes/store';
import { validateDescription } from '@/services/gbp/changes/policy';
import { readLocationRaw } from '@/lib/gbpClient';

/**
 * Turns the active SEO plan's description into a FR-5 proposal.
 * The title is not included: a business name is never applied from the plan.
 * Nothing is sent to Google here.
 */
export async function applyActivePlanToProfile(businessId: string): Promise<{
  applied: boolean;
  liveWriteApplied: false;
  proposalId?: string;
  reason: string;
}> {
  await dbConnect();
  const plan = await SeoPlan.findOne({ businessId, status: 'active' }).sort({ version: -1 }).lean();
  if (!plan) return { applied: false, liveWriteApplied: false, reason: 'No active SEO plan for this business.' };
  const description = plan.suggestedDescription?.trim();
  if (!description) return { applied: false, liveWriteApplied: false, reason: 'The active plan has no description draft to propose.' };
  const token = await GBPToken.findOne({ businessId }).select('locationId').lean<{ locationId?: string }>();
  if (!token?.locationId) return { applied: false, liveWriteApplied: false, reason: 'Google Business Profile is not connected.' };
  let before = '';
  try {
    const live = await readLocationRaw(businessId, 'profile,categories,storefrontAddress');
    before = live?.profile?.description || '';
    const tokens = [live?.categories?.primaryCategory?.displayName, live?.storefrontAddress?.locality].filter(Boolean);
    const allowedNumbers = (Array.isArray(plan.baseline) ? plan.baseline : []).flatMap((row) =>
      [row?.reviewCount, row?.rating, row?.avgRank, row?.overallScore, row?.completionPct]
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
        .map((n) => String(n)),
    );
    const competitorNames = (Array.isArray(plan.competitorLandscape) ? plan.competitorLandscape : [])
      .map((row: { name?: string; businessName?: string }) => row?.name || row?.businessName || '')
      .filter(Boolean);
    const validation = validateDescription(description, { tokens, allowedNumbers, competitorNames });
    const change = await createChange({
      businessId,
      locationId: token.locationId,
      kind: 'description',
      fields: ['description'],
      source: 'seo_plan',
      before,
      proposed: description.slice(0, 750),
      validation,
      requestedBy: 'seo_plan',
      recommendationRef: { seoPlanId: String(plan._id), version: plan.version },
    });
    await SeoPlan.updateOne({ _id: plan._id }, { $set: { proposedChangeId: change._id.toString() } });
    return {
      applied: false,
      liveWriteApplied: false,
      proposalId: change._id.toString(),
      reason: validation.valid
        ? 'Description proposed. Review and approve it before anything is sent to Google. The business name was not included.'
        : `Description was not proposed for apply: ${validation.violations.map((v) => v.message).join(' ')}`,
    };
  } catch (err: any) {
    return { applied: false, liveWriteApplied: false, reason: 'Could not read the current Google description, so no proposal was created.' };
  }
}
