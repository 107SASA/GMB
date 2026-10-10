/**
 * Weekly photo-quota maths for the home screen's AI Agent card. Pure.
 *
 * A photo counts from the moment it was really added:
 *   - uploaded through GrowwMatics → its createdAt (the upload time);
 *   - reconciled from Google ('google_sync') → Google's own createTime.
 * A synced record's createdAt is only the time our sync first saw it, so
 * counting it made every older Google photo look like this week's upload
 * (the card showed "0 Photos left" whatever the owner did). Synced records
 * without a Google timestamp are not counted.
 */
export const WEEKLY_PHOTO_QUOTA = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface QuotaMediaItem {
  createdAt?: string;
  publishedVia?: string;
  googleCreateTime?: string | null;
}

export function addedAt(item: QuotaMediaItem): number | null {
  const raw = item.publishedVia === 'google_sync' ? item.googleCreateTime : item.createdAt;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

export function photoQuota(items: QuotaMediaItem[], now: number = Date.now()) {
  const ages = items.map(addedAt).filter((t): t is number => t !== null).map((t) => now - t);
  const usedThisWeek = ages.filter((age) => age >= 0 && age < 7 * DAY_MS).length;
  const usedLastWeek = ages.filter((age) => age >= 7 * DAY_MS && age < 14 * DAY_MS).length;
  return {
    usedThisWeek,
    photosLeft: Math.max(0, WEEKLY_PHOTO_QUOTA - usedThisWeek),
    isActive: usedThisWeek > 0 || usedLastWeek > 0,
  };
}
