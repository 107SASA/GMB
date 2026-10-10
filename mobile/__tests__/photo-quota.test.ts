import { addedAt, photoQuota, WEEKLY_PHOTO_QUOTA } from '../src/lib/photo-quota';

const NOW = Date.parse('2026-10-11T10:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW - d * 86400000).toISOString();

describe('photoQuota', () => {
  it('does not count older Google photos just because the sync saw them today', () => {
    // Six photos already on Google for months, reconciled by today's sync.
    const synced = Array.from({ length: 6 }, () => ({ publishedVia: 'google_sync', createdAt: daysAgo(0), googleCreateTime: daysAgo(120) }));
    const q = photoQuota(synced, NOW);
    expect(q.usedThisWeek).toBe(0);
    expect(q.photosLeft).toBe(WEEKLY_PHOTO_QUOTA);
    expect(q.isActive).toBe(false);
  });

  it('counts photos uploaded through the app by their upload time', () => {
    const uploads = [{ createdAt: daysAgo(1) }, { createdAt: daysAgo(3), publishedVia: 'growwmatics' }];
    expect(photoQuota(uploads, NOW)).toEqual({ usedThisWeek: 2, photosLeft: 2, isActive: true });
  });

  it('counts a photo added directly on Google this week by Google’s own time', () => {
    const q = photoQuota([{ publishedVia: 'google_sync', createdAt: daysAgo(0), googleCreateTime: daysAgo(2) }], NOW);
    expect(q.usedThisWeek).toBe(1);
    expect(q.photosLeft).toBe(3);
  });

  it('ignores synced records without a Google timestamp', () => {
    expect(addedAt({ publishedVia: 'google_sync', createdAt: daysAgo(0) })).toBeNull();
    expect(photoQuota([{ publishedVia: 'google_sync', createdAt: daysAgo(0), googleCreateTime: null }], NOW).usedThisWeek).toBe(0);
  });

  it('stays active for one week of grace after the last upload, then needs attention', () => {
    expect(photoQuota([{ createdAt: daysAgo(10) }], NOW)).toEqual({ usedThisWeek: 0, photosLeft: 4, isActive: true });
    expect(photoQuota([{ createdAt: daysAgo(15) }], NOW).isActive).toBe(false);
  });

  it('never goes below zero once the weekly goal is met', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ createdAt: daysAgo(i * 0.5) }));
    expect(photoQuota(many, NOW).photosLeft).toBe(0);
  });
});
