/**
 * App Links / Universal Links verification files: served only when the
 * signing identity is configured; malformed values are ignored.
 * Run: npx tsx --test tests/workflow/app-links.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const FP = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase().padStart(2, '0')).join(':');

test('assetlinks.json: 404 until a fingerprint is set; package and fingerprint when set', async () => {
  const { GET } = await import('../../src/app/.well-known/assetlinks.json/route');
  delete process.env.ANDROID_APP_SHA256_FINGERPRINTS;
  assert.equal((await GET()).status, 404);
  process.env.ANDROID_APP_SHA256_FINGERPRINTS = 'not-a-fingerprint';
  assert.equal((await GET()).status, 404, 'malformed value ignored');
  process.env.ANDROID_APP_SHA256_FINGERPRINTS = ` ${FP.toLowerCase()} , junk`;
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body[0].target.package_name, 'com.growwmatics.app');
  assert.deepEqual(body[0].target.sha256_cert_fingerprints, [FP]);
  assert.deepEqual(body[0].relation, ['delegate_permission/common.handle_all_urls']);
  delete process.env.ANDROID_APP_SHA256_FINGERPRINTS;
});

test('apple-app-site-association: 404 until an app id is set; dashboard paths only', async () => {
  const { GET } = await import('../../src/app/.well-known/apple-app-site-association/route');
  delete process.env.APPLE_APP_IDS;
  assert.equal((await GET()).status, 404);
  process.env.APPLE_APP_IDS = 'ABCDE12345.com.other.app';
  assert.equal((await GET()).status, 404, 'another bundle id is refused');
  process.env.APPLE_APP_IDS = 'ABCDE12345.com.growwmatics.app';
  const res = await GET();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const body = await res.json();
  assert.deepEqual(body.applinks.details[0].appIDs, ['ABCDE12345.com.growwmatics.app']);
  assert.equal(body.applinks.details[0].components[0]['/'], '/dashboard/*');
  delete process.env.APPLE_APP_IDS;
});
