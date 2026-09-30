/**
 * SSRF guard — blocked addresses in every notation Node's URL parser can
 * produce. Run: node --experimental-strip-types --test tests/integration/ssrf-guard.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrlShape, isBlockedAddress } from '../../src/lib/ssrfGuard.ts';

test('ssrf: private / loopback / metadata IPv4 blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  assert.equal(isBlockedAddress('8.8.8.8'), false);
});

test('ssrf: IPv6 loopback, private and IPv4-embedded forms blocked', () => {
  for (const ip of ['::1', '::', 'fe80::1', 'fd00::1', 'ff02::1', '::ffff:7f00:1', '::ffff:127.0.0.1',
    '0:0:0:0:0:ffff:a9fe:a9fe', '::ffff:a9fe:a9fe', '::127.0.0.1', '64:ff9b::a00:1', '2002:7f00:1::', '::ffff:0:7f00:1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  assert.equal(isBlockedAddress('2606:4700:4700::1111'), false, 'public v6 allowed');
  assert.equal(isBlockedAddress('::ffff:808:808'), false, 'mapped public v4 allowed');
});

test('ssrf: URL shapes as Node parses them are refused', () => {
  for (const u of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:169.254.169.254]/latest/meta-data/', 'http://0x7f000001/',
    'http://2130706433/', 'http://127.1/', 'http://localhost/', 'http://foo.internal/', 'file:///etc/passwd',
    'http://user:pw@example.com/', 'http://example.com:8080/', 'http://[::1]/']) {
    assert.equal(checkUrlShape(u).ok, false, u);
  }
  assert.equal(checkUrlShape('https://example.com/services').ok, true);
});
