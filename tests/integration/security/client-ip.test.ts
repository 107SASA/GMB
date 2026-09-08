/**
 * SEC-9 — client-IP resolution for rate limiting behind Nginx.
 *
 * Pure-function test (no DB, no server). Locks in that a client cannot spoof
 * its rate-limit identity with an arbitrary X-Forwarded-For, given the
 * production topology Client -> Nginx -> Node where Nginx appends the real
 * peer address as the LAST X-Forwarded-For entry and sets X-Real-IP.
 *
 * Run with: node --test tests/integration/security/client-ip.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClientIp } from '../../../src/lib/rateLimit.ts';

const mk = (headers: Record<string, string>) => new Request('http://app.internal/api/auth/login', { headers });

test('X-Real-IP (set by Nginx from $remote_addr) is used when present', () => {
  const ip = getClientIp(mk({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 203.0.113.7' }));
  assert.equal(ip, '203.0.113.7');
});

test('a spoofed X-Forwarded-For prefix cannot win — the last hop (Nginx-appended) is used', () => {
  // Attacker sends "X-Forwarded-For: 9.9.9.9"; Nginx appends the real peer.
  const ip = getClientIp(mk({ 'x-forwarded-for': '9.9.9.9, 198.51.100.23' }));
  assert.equal(ip, '198.51.100.23');
});

test('multiple spoofed entries still cannot win', () => {
  const ip = getClientIp(mk({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 7.7.7.7, 198.51.100.23' }));
  assert.equal(ip, '198.51.100.23');
});

test('two attackers spoofing the same fake IP get DIFFERENT rate-limit keys (their real IPs)', () => {
  const a = getClientIp(mk({ 'x-forwarded-for': '9.9.9.9, 198.51.100.1' }));
  const b = getClientIp(mk({ 'x-forwarded-for': '9.9.9.9, 198.51.100.2' }));
  assert.notEqual(a, b);
});

test('TRUSTED_PROXY_COUNT=2 (Cloudflare + Nginx) picks the entry the outermost trusted proxy appended', () => {
  const prev = process.env.TRUSTED_PROXY_COUNT;
  process.env.TRUSTED_PROXY_COUNT = '2';
  try {
    // Chain: [client-spoofed, real-client (Cloudflare appended), CF-edge-ip (Nginx appended)]
    // With 2 trusted hops, parts[len-2] is what Cloudflare saw as the client.
    const ip = getClientIp(mk({ 'x-forwarded-for': '9.9.9.9, 203.0.113.9, 172.16.0.1' }));
    assert.equal(ip, '203.0.113.9');
    // And without a spoofed prefix: [real-client, CF-edge-ip] → parts[0].
    const ip2 = getClientIp(mk({ 'x-forwarded-for': '203.0.113.9, 172.16.0.1' }));
    assert.equal(ip2, '203.0.113.9');
  } finally {
    if (prev === undefined) delete process.env.TRUSTED_PROXY_COUNT;
    else process.env.TRUSTED_PROXY_COUNT = prev;
  }
});

test('no proxy headers → a single shared "unknown" bucket (fails restrictive, never permissive)', () => {
  assert.equal(getClientIp(mk({})), 'unknown');
});
