/**
 * Connecting Google reads EVERY Business Profile account of the login, not
 * just the first (Nov 2026, "BNI Kolkata South": the first account was a
 * personal one with no locations, so the connection was saved empty).
 * Run: node --experimental-strip-types --test tests/integration/gbp-locations-all-accounts.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAllGbpLocations, autoPickLocation, rankLocationsForPlace } from '../../src/lib/gbpLocations.ts';

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as any;

function fakeGoogle(routes: Record<string, any>) {
  const seen: string[] = [];
  const fetchFn = (async (url: string) => {
    seen.push(url);
    for (const [prefix, reply] of Object.entries(routes)) if (url.includes(prefix)) return typeof reply === 'function' ? reply(url) : reply;
    return json({}, 404);
  }) as any;
  return { fetchFn, seen };
}

test('personal account first with nothing in it → the location in the second account is found, with its account', async () => {
  const { fetchFn } = fakeGoogle({
    '/v1/accounts?': json({ accounts: [{ name: 'accounts/111', type: 'PERSONAL' }, { name: 'accounts/222', type: 'LOCATION_GROUP' }] }),
    '/v1/accounts/111/locations': json({}),
    '/v1/accounts/222/locations': json({ locations: [{ name: 'locations/9', title: 'BNI Kolkata South', metadata: { placeId: 'ChIJx' } }] }),
  });
  const r = await listAllGbpLocations('t', fetchFn);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.locations.map((l) => [l.locationId, l.accountId, l.title, l.placeId]), [['locations/9', 'accounts/222', 'BNI Kolkata South', 'ChIJx']]);
});

test('every page of locations is read; a location shared by two accounts is listed once', async () => {
  const { fetchFn } = fakeGoogle({
    '/v1/accounts?': json({ accounts: [{ name: 'accounts/1' }, { name: 'accounts/2' }] }),
    '/v1/accounts/1/locations': (url: string) => url.includes('pageToken=p2')
      ? json({ locations: [{ name: 'locations/b', title: 'B' }] })
      : json({ locations: [{ name: 'locations/a', title: 'A' }], nextPageToken: 'p2' }),
    '/v1/accounts/2/locations': json({ locations: [{ name: 'locations/a', title: 'A' }, { name: 'locations/c', title: 'C' }] }),
  });
  const r = await listAllGbpLocations('t', fetchFn);
  assert.deepEqual(r.ok && r.locations.map((l) => l.locationId), ['locations/a', 'locations/b', 'locations/c']);
});

test('no locations anywhere → ok with an empty list (the callback then refuses to connect)', async () => {
  const { fetchFn } = fakeGoogle({ '/v1/accounts?': json({ accounts: [{ name: 'accounts/1' }] }), '/v1/accounts/1/locations': json({}) });
  const r = await listAllGbpLocations('t', fetchFn);
  assert.equal(r.ok && r.locations.length, 0);
});

test('Google errors are reported, never turned into "no locations"', async () => {
  const denied = await listAllGbpLocations('t', fakeGoogle({ '/v1/accounts?': json({ error: 'denied' }, 403) }).fetchFn);
  assert.deepEqual(denied.ok ? null : [denied.reason, (denied as any).status], ['accounts_failed', 403]);
  const none = await listAllGbpLocations('t', fakeGoogle({ '/v1/accounts?': json({ accounts: [] }) }).fetchFn);
  assert.equal(none.ok ? null : none.reason, 'no_accounts');
  const allFailed = await listAllGbpLocations('t', fakeGoogle({ '/v1/accounts?': json({ accounts: [{ name: 'accounts/1' }] }), '/v1/accounts/1/locations': json({}, 500) }).fetchFn);
  assert.equal(allFailed.ok ? null : allFailed.reason, 'locations_failed');
  // One account failing while another works still connects the working one.
  const partial = await listAllGbpLocations('t', fakeGoogle({
    '/v1/accounts?': json({ accounts: [{ name: 'accounts/1' }, { name: 'accounts/2' }] }),
    '/v1/accounts/1/locations': json({}, 403),
    '/v1/accounts/2/locations': json({ locations: [{ name: 'locations/z', title: 'Z' }] }),
  }).fetchFn);
  assert.deepEqual(partial.ok && partial.locations.map((l) => l.locationId), ['locations/z']);
});

// Nov 2026, "Michelle's Foods": two copies of one listing shared the workspace's placeId; the first was connected silently.
const loc = (id: string, placeId?: string, hasVoiceOfMerchant?: boolean, duplicateOf?: string) =>
  ({ locationId: `locations/${id}`, accountId: 'accounts/1', title: id, storefrontAddress: null, placeId, hasVoiceOfMerchant, duplicateOf });

test('hasVoiceOfMerchant and duplicateLocation are read from location metadata', async () => {
  const { fetchFn } = fakeGoogle({
    '/v1/accounts?': json({ accounts: [{ name: 'accounts/1' }] }),
    '/v1/accounts/1/locations': json({ locations: [
      { name: 'locations/v', metadata: { placeId: 'P', hasVoiceOfMerchant: true } },
      { name: 'locations/d', metadata: { placeId: 'P', duplicateLocation: 'locations/v' } },
    ] }),
  });
  const r = await listAllGbpLocations('t', fetchFn);
  assert.deepEqual(r.ok && r.locations.map((l) => [l.locationId, l.hasVoiceOfMerchant, l.duplicateOf]),
    [['locations/v', true, undefined], ['locations/d', false, 'locations/v']]);
});

test('autoPickLocation: clear cases connect automatically', () => {
  const id = (l: any) => l?.locationId ?? null;
  assert.equal(id(autoPickLocation([loc('a', 'P')], null)), 'locations/a', 'single clean profile');
  assert.equal(id(autoPickLocation([loc('a', 'Q'), loc('b', 'P')], 'P')), 'locations/b', 'single placeId match');
  assert.equal(id(autoPickLocation([loc('dup', 'P'), loc('real', 'P', true)], 'P')), 'locations/real', 'verified beats copy');
  assert.equal(id(autoPickLocation([loc('real', 'P'), loc('dup', 'P', false, 'locations/real')], 'P')), null, 'one unflagged + one flagged, none verified: still unclear');
});

test('autoPickLocation: unclear cases go to the picker', () => {
  assert.equal(autoPickLocation([loc('a', 'P'), loc('b', 'P')], 'P'), null, 'Michelle: two unverified copies of the same listing');
  assert.equal(autoPickLocation([loc('a', 'P', false, 'locations/x')], 'P'), null, 'a lone duplicate is shown, with its warning');
  assert.equal(autoPickLocation([loc('a', 'Q'), loc('b', 'R')], 'P'), null, 'no placeId match among several');
  assert.equal(autoPickLocation([loc('a', 'Q'), loc('b', 'R')], null), null, 'no placeId on file');
  assert.equal(autoPickLocation([loc('a', 'P', false, 'locations/x'), loc('b', 'Q')], 'P'), null, 'only match is a duplicate');
});

test('rankLocationsForPlace: own listing first, verified before copies, duplicates last, otherwise original order', () => {
  const order = (ls: ReturnType<typeof loc>[], placeId?: string) => rankLocationsForPlace(ls, placeId).map((l) => l.title);
  assert.deepEqual(order([loc('other', 'Q'), loc('dup', 'P', false, 'locations/x'), loc('copy', 'P'), loc('real', 'P', true)], 'P'),
    ['real', 'copy', 'dup', 'other']);
  assert.deepEqual(order([loc('a', 'Q'), loc('b', 'R')], null), ['a', 'b']);
});
