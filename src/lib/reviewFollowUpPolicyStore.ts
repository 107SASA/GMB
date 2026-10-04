import dbConnect from '@/lib/mongodb';
import ReviewFollowUpPolicy from '@/models/ReviewFollowUpPolicy';
import {
  DEFAULT_GLOBAL_REVIEW_FOLLOW_UP,
  validateGlobalReviewFollowUpSettings,
  type GlobalReviewFollowUpSettings,
} from '@/lib/reviewFollowUpSettings';

function toSettings(doc: {
  enabled?: boolean;
  initialFollowUpDelayDays?: number;
  secondFollowUpDelayDays?: number;
  maximumFollowUps?: number;
  minimumIntervalDays?: number;
  stopOnOptOut?: boolean;
}): GlobalReviewFollowUpSettings {
  return {
    enabled: doc.enabled !== false,
    initialFollowUpDelayDays: doc.initialFollowUpDelayDays ?? DEFAULT_GLOBAL_REVIEW_FOLLOW_UP.initialFollowUpDelayDays,
    secondFollowUpDelayDays: doc.secondFollowUpDelayDays ?? DEFAULT_GLOBAL_REVIEW_FOLLOW_UP.secondFollowUpDelayDays,
    maximumFollowUps: doc.maximumFollowUps ?? DEFAULT_GLOBAL_REVIEW_FOLLOW_UP.maximumFollowUps,
    minimumIntervalDays: doc.minimumIntervalDays ?? DEFAULT_GLOBAL_REVIEW_FOLLOW_UP.minimumIntervalDays,
    stopOnOptOut: true,
    stopOnClick: false,
    stopOnReview: false,
  };
}

/** The one active policy. Creates the historical default the first time it is missing. */
export async function loadReviewFollowUpPolicy(): Promise<GlobalReviewFollowUpSettings> {
  await dbConnect();
  await ReviewFollowUpPolicy.collection.createIndex({ key: 1 }, { unique: true, name: 'key_1' });
  const existing = await ReviewFollowUpPolicy.findOne({ key: 'global' }).lean();
  if (existing) return toSettings(existing);

  try {
    const created = await ReviewFollowUpPolicy.create({
      key: 'global',
      ...DEFAULT_GLOBAL_REVIEW_FOLLOW_UP,
    });
    return toSettings(created);
  } catch (error: unknown) {
    const code = (error as { code?: number })?.code;
    if (code === 11000) {
      const raced = await ReviewFollowUpPolicy.findOne({ key: 'global' }).lean();
      if (raced) return toSettings(raced);
    }
    throw error;
  }
}

export async function saveReviewFollowUpPolicy(
  input: unknown
): Promise<{ ok: true; value: GlobalReviewFollowUpSettings } | { ok: false; error: string }> {
  const validated = validateGlobalReviewFollowUpSettings(input);
  if (!validated.ok) return validated;

  await dbConnect();
  await ReviewFollowUpPolicy.findOneAndUpdate(
    { key: 'global' },
    { $set: { key: 'global', ...validated.value } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { ok: true, value: validated.value };
}
