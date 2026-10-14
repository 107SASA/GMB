/**
 * Pure unit tests for the migration safety controls — no DB, no `@/` aliases.
 * Run: node --experimental-strip-types --test tests/unit/jobs-safety.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkWebOwnership,
  evaluateOwnership,
  guardConfig,
  waitForOwnership,
  DEFAULT_OWNERSHIP_URL,
} from '../../src/services/jobs/ownershipGuard.ts';
import { _resetSuppressionCounters, isOutboundSuppressed, suppressOutbound } from '../../src/lib/outboundSuppression.ts';

const payload = (over: Record<string, unknown> = {}) => ({
  version: 1,
  known: ['a', 'b', 'c', 'd'],
  served: ['a', 'c'],
  native: ['b', 'd'],
  ...over,
});
const owned = new Set(['b', 'd']);

// ----------------------------------------------------- ownership guard --

test('guard: ok when web released exactly the owned ids', () => {
  assert.deepEqual(evaluateOwnership(payload(), owned), { ok: true, served: 2, native: 2 });
});

test('guard: web still serves an owned id => not ok (the double-owner case)', () => {
  const v = evaluateOwnership(payload({ served: ['a', 'b', 'c'] }), owned);
  assert.equal(v.ok, false);
  assert.deepEqual((v as any).conflicting, ['b']);
});

test('guard: owned id unknown to web registry (typo / version skew) => not ok', () => {
  const v = evaluateOwnership(payload(), new Set(['b', 'zzz']));
  assert.equal(v.ok, false);
  assert.deepEqual((v as any).conflicting, ['zzz']);
});

test('guard: web loaded a different JOBS_NATIVE_FUNCTIONS (not restarted) => ambiguous => not ok', () => {
  const v = evaluateOwnership(payload({ served: ['a', 'c'], native: ['b'] }), owned);
  assert.equal(v.ok, false);
  assert.deepEqual((v as any).conflicting, ['d']);
});

test('guard: malformed responses fail closed', () => {
  const bad = [null, 'x', 42, {}, { version: 2 }, payload({ served: 'a' }), payload({ known: [1] }), payload({ native: undefined })];
  for (const b of bad) assert.equal(evaluateOwnership(b, owned).ok, false);
  assert.equal(evaluateOwnership(payload(), new Set()).ok, false, 'worker with no owned ids never passes');
});

const res = (status: number, body: unknown, rawBad = false) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (rawBad) throw new SyntaxError('bad json');
      return body;
    },
  }) as any;

test('guard: transport failures fail closed (HTTP error, bad JSON, network error, timeout)', async () => {
  const opts = { url: 'http://x', token: 't', owned };
  assert.equal((await checkWebOwnership({ ...opts, fetchImpl: async () => res(500, {}) })).ok, false);
  assert.equal((await checkWebOwnership({ ...opts, fetchImpl: async () => res(404, {}) })).ok, false);
  assert.equal((await checkWebOwnership({ ...opts, fetchImpl: async () => res(200, null, true) })).ok, false);
  assert.equal(
    (await checkWebOwnership({ ...opts, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } })).ok,
    false
  );
  const hang: any = (_u: string, init: any) =>
    new Promise((_r, rej) =>
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    );
  const v = await checkWebOwnership({ ...opts, timeoutMs: 30, fetchImpl: hang });
  assert.equal(v.ok, false);
  assert.match((v as any).reason, /timeout/);
});

test('guard: sends the bearer token to the configured URL; never echoes it in the verdict', async () => {
  let seen: any;
  const v = await checkWebOwnership({
    url: 'http://127.0.0.1:3000/api/inngest/ownership',
    token: 'sekret-token',
    owned,
    fetchImpl: async (u: any, init: any) => {
      seen = { u, h: init.headers };
      return res(200, payload());
    },
  });
  assert.equal(v.ok, true);
  assert.equal(seen.h.authorization, 'Bearer sekret-token');
  assert.ok(!JSON.stringify(v).includes('sekret-token'));
});

test('guard: waitForOwnership retries through a web restart, then passes', async () => {
  let n = 0;
  const v = await waitForOwnership({
    url: 'http://x',
    token: 't',
    owned,
    attempts: 5,
    delayMs: 0,
    sleep: async () => {},
    fetchImpl: async () => (++n < 3 ? res(503, {}) : res(200, payload())),
  });
  assert.equal(v.ok, true);
  assert.equal(n, 3);
});

test('guard: waitForOwnership gives up after the attempt budget (caller exits non-zero)', async () => {
  let n = 0;
  const v = await waitForOwnership({
    url: 'http://x',
    token: 't',
    owned,
    attempts: 4,
    delayMs: 0,
    sleep: async () => {},
    fetchImpl: async () => {
      n++;
      throw new Error('down');
    },
  });
  assert.equal(v.ok, false);
  assert.equal(n, 4);
});

test('guardConfig: safe local default; cannot be disabled in production', () => {
  assert.equal(guardConfig({} as any).url, DEFAULT_OWNERSHIP_URL);
  assert.ok(DEFAULT_OWNERSHIP_URL.startsWith('http://127.0.0.1'));
  assert.equal(guardConfig({ JOBS_OWNERSHIP_GUARD: 'off', NODE_ENV: 'development' } as any).enabled, false);
  assert.equal(guardConfig({ JOBS_OWNERSHIP_GUARD: 'off', NODE_ENV: 'production' } as any).enabled, true);
  assert.equal(guardConfig({ JOBS_OWNERSHIP_URL: 'http://127.0.0.1:3001/o' } as any).url, 'http://127.0.0.1:3001/o');
});

test('registry drift: every exported Inngest function is registered in /api/inngest/route.ts', () => {
  const fns = readFileSync('src/services/inngest/functions.ts', 'utf8');
  const route = readFileSync('src/app/api/inngest/route.ts', 'utf8');
  const exported = [...fns.matchAll(/export const (\w+) = inngest\.createFunction/g)].map((m) => m[1]);
  assert.ok(exported.length >= 50);
  const missing = exported.filter((n) => !new RegExp('\\b' + n + '\\b').test(route));
  assert.deepEqual(missing, [], 'a function missing from the route would be served by nobody');
});

// ---------------------------------------------------- outbound suppression --

test('suppression: off by default; each flag covers exactly its channels', () => {
  const none = {} as any;
  for (const ch of ['whatsapp', 'push', 'email'] as const) assert.equal(isOutboundSuppressed(ch, none), false);
  const all = { QA_SUPPRESS_OUTBOUND_SENDS: 'true' } as any;
  for (const ch of ['whatsapp', 'push', 'email'] as const) assert.equal(isOutboundSuppressed(ch, all), true);
  const legacy = { QA_SUPPRESS_WHATSAPP_SENDS: 'true' } as any;
  assert.equal(isOutboundSuppressed('whatsapp', legacy), true);
  assert.equal(isOutboundSuppressed('push', legacy), false, 'legacy flag must not widen');
  assert.equal(isOutboundSuppressed('email', legacy), false);
  for (const v of ['1', 'TRUE', 'yes', '', 'false']) {
    assert.equal(isOutboundSuppressed('whatsapp', { QA_SUPPRESS_OUTBOUND_SENDS: v } as any), false);
  }
});

test('suppression log: channel/kind/count only, no content, recipient or credentials', () => {
  _resetSuppressionCounters();
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => {
    lines.push(a.map(String).join(' '));
  };
  try {
    assert.equal(suppressOutbound('whatsapp', 'meta', { QA_SUPPRESS_OUTBOUND_SENDS: 'true' } as any), true);
    assert.equal(suppressOutbound('whatsapp', 'meta', {} as any), false);
  } finally {
    console.warn = orig;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /channel=whatsapp kind=meta count=1/);
});
