import { gbpMediaItemSchema } from '../src/api/endpoints/gbp';

describe('gbpMediaItemSchema', () => {
  const base = { _id: 'a1', category: 'ADDITIONAL', url: 'https://x/a.jpg', status: 'staged', createdAt: '2026-10-11T00:00:00.000Z' };

  it('accepts items without the sync fields (app uploads)', () => {
    expect(gbpMediaItemSchema.parse(base)._id).toBe('a1');
  });

  it('does not reject an item whose sync fields are null or malformed', () => {
    const parsed = gbpMediaItemSchema.parse({ ...base, publishedVia: null, googleCreateTime: 42 });
    expect(parsed.publishedVia).toBeUndefined();
    expect(parsed.googleCreateTime).toBeNull();
  });

  it('keeps real values', () => {
    const parsed = gbpMediaItemSchema.parse({ ...base, publishedVia: 'google_sync', googleCreateTime: '2026-06-01T10:00:00.000Z' });
    expect(parsed.publishedVia).toBe('google_sync');
    expect(parsed.googleCreateTime).toBe('2026-06-01T10:00:00.000Z');
  });
});
