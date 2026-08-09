import dbConnect from '@/lib/mongodb';
import ProfileActivity, { type ProfileActivityType } from '@/models/ProfileActivity';

export async function logProfileActivity(params: {
  businessId: string;
  organizationId?: string;
  type: ProfileActivityType;
  title: string;
  detail?: string;
  updatedBy: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await dbConnect();
  try {
    await ProfileActivity.create(params);
  } catch (err) {
    // Never let activity-log failure break the actual write it's logging —
    // the profile edit / photo publish already succeeded by the time this
    // runs; losing one feed entry is a much smaller problem than surfacing
    // a false error for a request that actually worked.
    console.error('[logProfileActivity] failed:', err);
  }
}
