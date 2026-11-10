/**
 * Connecting Google reads EVERY Business Profile account of the login, not
 * just the first (Nov 2026, "BNI Kolkata South": the first account was a
 * personal one with no locations, so the connection was saved empty).
 * Run: node --experimental-strip-types --test tests/integration/gbp-locations-all-accounts.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAllGbpLocations } from '../../src/lib/gbpLocations.ts';

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
