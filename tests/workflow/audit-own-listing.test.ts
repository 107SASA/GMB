/**
 * S0 — the business's real Google listing (docs/FREE_REPORT_REBUILD_PLAN.md).
 * Cases from the 22 free reports checked in Nov 2026: the sign-up form saved
 * "Medical Clinic" / "Banking and Finance" / "Manufacturer" while the listing
 * shows "Mental health service" / "Property investment company" /
 * "Food Processing Company".
 *
 * Run: npx tsx --test tests/workflow/audit-own-listing.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickOwnListing, ownListingCategory, ownListingQuery, isOwnListingFresh, ownListingAsPublicProfile, OWN_LISTING_TTL_MS,
} from '../../src/services/audit/ownListing';

const now = new Date('2026-11-20T10:00:00Z');
const inspiron = [
  { title: 'Mind Matters Clinic', place_id: 'ChIJother', category: 'Psychologist' },
  {
    title: 'Inspiron Psychological Well-Being Centre - Indiranagar', place_id: 'ChIJinspiron',
    category: 'Mental health service', additionalCategories: ['Psychologist', 'Counselor'],
    snippet: 'Counselling and therapy', hasHours: true, totalPhotos: 40, reviews: 106, rating: 4.4,
  },
];

test('the own listing is found by Place ID and its real category is read', () => {
  const l = pickOwnListing(inspiron, ['ChIJinspiron'], 'inspiron bengaluru', now)!;
  assert.equal(l.category, 'Mental health service');
  assert.deepEqual(l.additionalCategories, ['Psychologist', 'Counselor']);
  assert.equal(l.reviewCount, 106);
  assert.equal(l.checkedAt, now.toISOString());
  // "places/…" ids match too.
  assert.ok(pickOwnListing(inspiron, ['places/ChIJinspiron'], 'q', now));
});

test('a similar name or another business is never taken as the own listing', () => {
  const lookalike = [{ title: 'Inspiron Psychological Well-Being Centre', place_id: 'ChIJsomeoneElse', category: 'Medical clinic' }];
  assert.equal(pickOwnListing(lookalike, ['ChIJinspiron'], 'q', now), null);
  assert.equal(pickOwnListing(inspiron, [], 'q', now), null);
  assert.equal(pickOwnListing(null, ['ChIJinspiron'], 'q', now), null);
});

test('category order: owner choice → Google listing → sign-up type → place types → Local Business', () => {
  const listing = { category: 'Mental health service' };
  assert.deepEqual(
    ownListingCategory({ listing, ownerConfirmed: null, stored: 'Medical Clinic', fromPlaceTypes: null }),
    { category: 'Mental health service', source: 'google_listing' },
  );
  assert.deepEqual(
    ownListingCategory({ listing, ownerConfirmed: 'Psychologist', stored: 'Medical Clinic', fromPlaceTypes: null }),
    { category: 'Psychologist', source: 'owner' },
  );
  assert.deepEqual(
    ownListingCategory({ listing: null, ownerConfirmed: null, stored: 'Banking and Finance', fromPlaceTypes: 'Finance' }),
    { category: 'Banking and Finance', source: 'signup' },
  );
  assert.deepEqual(
    ownListingCategory({ listing: { category: null }, ownerConfirmed: null, stored: 'Local Business', fromPlaceTypes: 'Restaurant' }),
    { category: 'Restaurant', source: 'place_types' },
  );
  assert.deepEqual(
    ownListingCategory({ listing: null, ownerConfirmed: '', stored: null, fromPlaceTypes: null }),
    { category: 'Local Business', source: 'none' },
  );
});

test('the search is the name, plus the city only when the name lacks it', () => {
  assert.equal(ownListingQuery('Zuper LED Bangalore', 'Bangalore'), 'Zuper LED Bangalore');
  assert.equal(ownListingQuery('Coco Houseboats', 'Alappuzha'), 'Coco Houseboats Alappuzha');
  assert.equal(ownListingQuery('  Pooja   Enterprises ', ''), 'Pooja Enterprises');
});

test('a saved listing is reused for 30 days, then read again', () => {
  const fresh = { checkedAt: new Date(now.getTime() - 5 * 86_400_000).toISOString() };
  const old = { checkedAt: new Date(now.getTime() - OWN_LISTING_TTL_MS - 1).toISOString() };
  assert.equal(isOwnListingFresh(fresh, now), true);
  assert.equal(isOwnListingFresh(old, now), false);
  assert.equal(isOwnListingFresh(null, now), false);
});

test('a business that ranks nowhere still gets its real listing fields', () => {
  const l = pickOwnListing(inspiron, ['ChIJinspiron'], 'q', now)!;
  const notSeen = { observed: false, category: null, additionalCategories: null, website: null, phone: null, hasHours: null, bookingUrl: null, isClaimed: null, totalPhotos: null };
  const p = ownListingAsPublicProfile(notSeen, l);
  assert.equal(p.observed, true);
  assert.equal(p.category, 'Mental health service');
  assert.equal(p.totalPhotos, 40);
  // When the searches did see it, their view is kept.
  const seen = { ...notSeen, observed: true, category: 'Psychologist' };
  assert.equal(ownListingAsPublicProfile(seen, l).category, 'Psychologist');
});
