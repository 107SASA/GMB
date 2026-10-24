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
  stopOnLinkClick?: boolean;
}): GlobalReviewFollowUpSettings {
  return {
    enabled: doc.enabled !== false,
    initialFollowUpDelayDays: doc.initialFollowUpDelayDays ?? DEFAULT_GLOBAL_REVIEW_FOLLOW_UP.initialFollowUpDelayDays,
    secondFollowUpDelayDays: doc.secondFollowUpDelayDays ?? DEFAULT_GLOBAL_REVIEW_FOLLOW_UP.secondFollowUpDelayDays,
    maximumFollowUps: doc.maximumFollowUps ?? DEFAULT_GLOBAL_REVIEW_FOLLOW_UP.maximumFollowUps,
    minimumIntervalDays: doc.minimumIntervalDays ?? DEFAULT_GLOBAL_REVIEW_FOLLOW_UP.minimumIntervalDays,
    stopOnOptOut: true,
    // Stored as stopOnLinkClick: the older stopOnClick field was always written
    // as false (it could not be turned on), so it is not a Super Admin choice.
    // Unset → the default, on.
    stopOnClick: doc.stopOnLinkClick !== false,
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
    const { stopOnClick, ...defaults } = DEFAULT_GLOBAL_REVIEW_FOLLOW_UP;
    const created = await ReviewFollowUpPolicy.create({
      key: 'global',
      ...defaults,
      stopOnLinkClick: stopOnClick,
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
  const { stopOnClick, ...rest } = validated.value;
  await ReviewFollowUpPolicy.findOneAndUpdate(
    { key: 'global' },
    { $set: { key: 'global', ...rest, stopOnLinkClick: stopOnClick } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { ok: true, value: validated.value };
}
