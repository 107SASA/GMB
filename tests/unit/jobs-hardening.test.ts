/**
 * Regression tests for the safety-hardening commit. Pure: no DB, no `@/` aliases.
 * Run: node --experimental-strip-types --test tests/unit/jobs-hardening.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnershipPayload, resolveWebOwnership, selectServedFunctions, toNativeFunction } from '../../src/services/jobs/adapter.ts';
import { nativeFunctionIds, nativeFunctionIdsStrict, partitionOwnership } from '../../src/services/jobs/config.ts';
import { pauseAckStatus } from '../../src/services/jobs/pauseWait.ts';
import { confirmDatabase, evaluateAdminTarget, parseMongoTarget } from '../../src/services/jobs/adminTarget.ts';
import { GuardMonitor } from '../../src/services/jobs/guardMonitor.ts';
import { fetchOwnershipPayload, releasedByWeb } from '../../src/services/jobs/ownershipGuard.ts';
import {
  SuppressedExternalOperation,
  _resetSuppressionCounters,
  guardExternalOperation,
  isOutboundSuppressed,
  isProductionLike,
  suppressOutbound,
  suppressionBoundaryViolations,
  suppressionSummary,
} from '../../src/lib/outboundSuppression.ts';
import { parseHosts, resolveLoopbackTestUri } from '../../scripts/lib/loopbackTestDb.mjs';

const E = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

// ------------------------------------------------------------ H1 --

test('H1: web-path ownership never throws; unknown / unsupported ids stay with Inngest', () => {
  const fns = [{ id: 'a' }, { id: 'b' }, { id: 'c', unsupported: ['opts.throttle'] }];
  const r = resolveWebOwnership(fns, new Set(['a', 'typo-id', 'c']));
  assert.deepEqual([...r.owned], ['a']);
  assert.deepEqual(r.rejected.map((x) => x.id).sort(), ['c', 'typo-id']);
  // all-typo input: nothing owned, nothing thrown
  assert.equal(resolveWebOwnership(fns, new Set(['nope'])).owned.size, 0);
});

test('H1: lenient web parse drops "*"/blanks; the worker parse still fails closed', () => {
  const env = E({ JOBS_NATIVE_ENABLED: 'true', JOBS_NATIVE_FUNCTIONS: ' a , *, ,b ' });
  assert.deepEqual([...nativeFunctionIds(env)].sort(), ['a', 'b']);
  assert.throws(() => nativeFunctionIdsStrict(env), /explicit function ids/);
});

test('H1: partitionOwnership reports unknown ids instead of throwing', () => {
  const p = partitionOwnership(['a', 'b'], E({ JOBS_NATIVE_ENABLED: 'true', JOBS_NATIVE_FUNCTIONS: 'a,zzz' }));
  assert.deepEqual(p.native, ['a']);
  assert.deepEqual(p.inngest, ['b']);
  assert.deepEqual(p.unknown, ['zzz']);
});

// ------------------------------------------------------------ H3 --

test('H3: pause is acknowledged only by post-pause heartbeats that are paused AND drained', () => {
  const since = new Date('2026-10-14T10:00:00Z');
  const now = new Date('2026-10-14T10:00:30Z');
  const opts = { since, now, liveWithinMs: 45_000 };
  const ok = { _id: 'w1', status: 'paused', paused: true, inFlight: 0, seenAt: new Date('2026-10-14T10:00:20Z') };

  assert.equal(pauseAckStatus([ok], opts).acked, true);
  // heartbeat predates the pause: proves nothing
  const old = { ...ok, seenAt: new Date('2026-10-14T09:59:50Z') };
  assert.equal(pauseAckStatus([old], opts).acked, false);
  // observed the pause but still draining
  const draining = { ...ok, status: 'draining', inFlight: 2 };
  const d = pauseAckStatus([draining], opts);
  assert.equal(d.acked, false);
  assert.match(d.waitingOn[0].reason, /in flight/);
  // has not observed it at all
  assert.equal(pauseAckStatus([{ ...ok, paused: false }], opts).acked, false);
  // one slow worker blocks acknowledgement for everyone
  assert.equal(pauseAckStatus([ok, draining], opts).acked, false);
});

test('H3: stopped or silent workers are not waited on; no live workers is reported explicitly', () => {
  const since = new Date('2026-10-14T10:00:00Z');
  const now = new Date('2026-10-14T10:05:00Z');
  const stopped = { _id: 'w', status: 'stopped', paused: false, inFlight: 0, seenAt: new Date('2026-10-14T10:04:59Z') };
  const silent = { _id: 'x', status: 'running', paused: false, inFlight: 1, seenAt: new Date('2026-10-14T09:00:00Z') };
  const r = pauseAckStatus([stopped, silent], { since, now, liveWithinMs: 45_000 });
  assert.equal(r.acked, true);
  assert.equal(r.noLiveWorkers, true);
});

// ------------------------------------------------------------ M2 --

test('M2: parseMongoTarget extracts db and hosts without exposing credentials', () => {
  const t = parseMongoTarget('mongodb://user:p%40ss@h1.example.net:27017,h2.example.net:27017/growwmatics_prod?ssl=true');
  assert.equal(t.dbName, 'growwmatics_prod');
  assert.deepEqual(t.hosts, ['h1.example.net:27017', 'h2.example.net:27017']);
  assert.ok(!JSON.stringify(t).includes('p%40ss'));
  assert.equal(parseMongoTarget('mongodb+srv://u:p@c.example.net/?retryWrites=true').hasExplicitDb, false);
  assert.equal(parseMongoTarget('garbage').scheme, '');
});

test('M2: ambiguous targets are refused', () => {
  const noDb = evaluateAdminTarget(parseMongoTarget('mongodb://u:p@h.example.net'));
  assert.equal(noDb.ok, false);
  assert.match(noDb.problems.join(' '), /"test"/);
  assert.equal(evaluateAdminTarget(parseMongoTarget('x')).ok, false);
});

test('M2: a prod-looking database under a non-production NODE_ENV is refused unless overridden', () => {
  const t = parseMongoTarget('mongodb://u:p@h/growwmatics_prod');
  assert.equal(evaluateAdminTarget(t, E({ NODE_ENV: 'development' })).ok, false);
  assert.equal(evaluateAdminTarget(t, E({ NODE_ENV: 'production' })).ok, true);
  assert.equal(evaluateAdminTarget(t, E({ NODE_ENV: 'development', ALLOW_PROD_DB: 'iunderstand' })).ok, true);
  // the default "test" db is allowed but flagged
  const w = evaluateAdminTarget(parseMongoTarget('mongodb://u:p@h/test'), E({ NODE_ENV: 'production' }));
  assert.equal(w.ok, true);
  assert.ok(w.warnings.some((x) => /"test"/.test(x)));
});

test('M2: typed confirmation must match exactly; never defaults to yes', async () => {
  assert.equal(await confirmDatabase({ expected: 'db1', flag: 'db1' }), true);
  assert.equal(await confirmDatabase({ expected: 'db1', flag: 'db2' }), false);
  assert.equal(await confirmDatabase({ expected: 'db1' }), false, 'no flag and no prompt');
  assert.equal(await confirmDatabase({ expected: 'db1', prompt: async () => 'db1\n' }), true);
  assert.equal(await confirmDatabase({ expected: 'db1', prompt: async () => 'yes' }), false);
  assert.equal(await confirmDatabase({ expected: 'db1', prompt: async () => '' }), false);
});

// ------------------------------------------------------------ M3 --

test('M3: suppression is never honoured in a production-like environment', () => {
  const prod = E({ NODE_ENV: 'production', QA_SUPPRESS_OUTBOUND_SENDS: 'true' });
  assert.equal(isProductionLike(prod), true);
  for (const ch of ['whatsapp', 'push', 'email', 'calendar', 'razorpay', 'oauth'] as const) {
    assert.equal(isOutboundSuppressed(ch, prod), false, ch);
  }
  assert.equal(suppressOutbound('whatsapp', 'meta', prod), false);
  assert.doesNotThrow(() => guardExternalOperation('razorpay', 'subscriptions.cancel', prod));
  // legacy WhatsApp flag too
  assert.equal(isOutboundSuppressed('whatsapp', E({ NODE_ENV: 'production', QA_SUPPRESS_WHATSAPP_SENDS: 'true' })), false);
});

test('M3: honoured outside production, and in production only with an explicit staging marker', () => {
  assert.equal(isOutboundSuppressed('email', E({ NODE_ENV: 'development', QA_SUPPRESS_OUTBOUND_SENDS: 'true' })), true);
  assert.equal(isOutboundSuppressed('email', E({ QA_SUPPRESS_OUTBOUND_SENDS: 'true' })), true, 'NODE_ENV unset');
  assert.equal(isOutboundSuppressed('email', E({ NODE_ENV: 'production', APP_ENV: 'staging', QA_SUPPRESS_OUTBOUND_SENDS: 'true' })), true);
  assert.equal(isOutboundSuppressed('email', E({ NODE_ENV: 'production', APP_ENV: 'production', QA_SUPPRESS_OUTBOUND_SENDS: 'true' })), false);
  assert.equal(isOutboundSuppressed('email', E({})), false);
});

test('M3: Calendar / Razorpay / OAuth mutations FAIL CLOSED instead of being simulated', () => {
  _resetSuppressionCounters();
  const env = E({ NODE_ENV: 'development', QA_SUPPRESS_OUTBOUND_SENDS: 'true' });
  for (const op of ['calendar', 'razorpay', 'oauth'] as const) {
    assert.throws(() => guardExternalOperation(op, 'x', env), (e: any) => e instanceof SuppressedExternalOperation && e.code === 'QA_SUPPRESSED');
  }
  // the legacy WhatsApp-only flag must not widen to these
  const legacy = E({ NODE_ENV: 'development', QA_SUPPRESS_WHATSAPP_SENDS: 'true' });
  assert.doesNotThrow(() => guardExternalOperation('calendar', 'x', legacy));
});

test('M3: boundary violations flag live credentials next to an active suppression flag', () => {
  assert.deepEqual(suppressionBoundaryViolations(E({ NODE_ENV: 'development' })), [], 'no flag, no violations');
  const v = suppressionBoundaryViolations(
    E({ NODE_ENV: 'development', QA_SUPPRESS_OUTBOUND_SENDS: 'true', RAZORPAY_KEY_ID: 'rzp_live_abc', GBP_LIVE_WRITES_ENABLED: 'true', ACCOUNT_PURGE_MODE: 'live' })
  );
  assert.equal(v.length, 3);
  assert.deepEqual(suppressionBoundaryViolations(E({ NODE_ENV: 'development', QA_SUPPRESS_OUTBOUND_SENDS: 'true', RAZORPAY_KEY_ID: 'rzp_test_abc' })), []);
});

test('M3: health summary carries counts only, never payloads', () => {
  _resetSuppressionCounters();
  const env = E({ NODE_ENV: 'development', QA_SUPPRESS_OUTBOUND_SENDS: 'true' });
  suppressOutbound('email', 'otp', env);
  suppressOutbound('email', 'otp', env);
  suppressOutbound('push', 'expo', env);
  const s = suppressionSummary(env);
  assert.equal(s.active, true);
  assert.equal(s.ignoredInProduction, false);
  assert.deepEqual(s.suppressed, { email: 2, push: 1 });
  const prod = suppressionSummary(E({ NODE_ENV: 'production', QA_SUPPRESS_OUTBOUND_SENDS: 'true' }));
  assert.equal(prod.active, false);
  assert.equal(prod.ignoredInProduction, true);
});

// ------------------------------------------------------------ M4 --

const verdicts = (...v: Array<{ ok: true; served: number; native: number } | { ok: false; reason: string } | Error>) => {
  let i = 0;
  return async () => {
    const x = v[Math.min(i++, v.length - 1)];
    if (x instanceof Error) throw x;
    return x as any;
  };
};
const quiet = () => {};

test('M4: monitor starts BLOCKED, unblocks on a good verdict, re-blocks on any failure, never throws', async () => {
  const m = new GuardMonitor({
    logger: quiet,
    check: verdicts(
      { ok: false, reason: 'web still serves owned ids' },
      { ok: true, served: 3, native: 1 },
      new Error('ECONNREFUSED'),
      { ok: true, served: 3, native: 1 }
    ),
  });
  assert.match(String(m.block), /startup check pending/, 'blocked before the first check');
  await m.checkNow();
  assert.match(String(m.block), /still serves/);
  await m.checkNow();
  assert.equal(m.block, null);
  await m.checkNow(); // throws inside check -> blocked, not crashed
  assert.match(String(m.block), /guard check threw/);
  await m.checkNow();
  assert.equal(m.block, null);
  assert.equal(m.state.checks, 4);
});

test('M4: monitor re-checks quickly while blocked and slowly while verified', async () => {
  let calls = 0;
  const m = new GuardMonitor({
    logger: quiet,
    okIntervalMs: 5_000,
    blockedIntervalMs: 10,
    check: async () => (++calls < 4 ? { ok: false, reason: 'not yet' } : { ok: true, served: 1, native: 1 }),
  });
  m.start();
  await new Promise((r) => setTimeout(r, 400));
  m.stop();
  assert.ok(calls >= 4, `blocked checks should be frequent, got ${calls}`);
  assert.equal(m.block, null, 'unblocked once the verdict turned ok');
});

test('M4: ownership payload helpers fail closed', async () => {
  const okRes = (b: unknown) => async () => ({ ok: true, status: 200, json: async () => b }) as any;
  assert.deepEqual([...(releasedByWeb({ version: 1, known: [], served: [], native: ['a'] }) as Set<string>)], ['a']);
  assert.equal(releasedByWeb({ version: 2 }), null);
  assert.equal(releasedByWeb(null), null);
  assert.equal((await fetchOwnershipPayload({ url: 'u', token: 't', fetchImpl: okRes({ a: 1 }) })).ok, true);
  const bad = await fetchOwnershipPayload({ url: 'u', token: 't', fetchImpl: (async () => ({ ok: false, status: 503 })) as any });
  assert.equal(bad.ok, false);
});

// ------------------------------------------------------------ M5 --

test('M5: test DB resolver fails closed (explicit, loopback, never prod, no MONGODB_URI fallback)', () => {
  assert.throws(() => resolveLoopbackTestUri({ dbName: 'd', env: E({ MONGODB_URI: 'mongodb://127.0.0.1/x' }) }), /TEST_MONGODB_URI is not set/);
  assert.throws(
    () => resolveLoopbackTestUri({ dbName: 'd', env: E({ TEST_MONGODB_URI: 'mongodb+srv://u:p@cluster0.abc.mongodb.net/x' }) }),
    /non-loopback/
  );
  assert.throws(
    () => resolveLoopbackTestUri({ dbName: 'd', env: E({ TEST_MONGODB_URI: 'mongodb://127.0.0.1:27017,evil.example.net:27017/x' }) }),
    /non-loopback/
  );
  assert.throws(() => resolveLoopbackTestUri({ dbName: 'growwmatics_prod', env: E({ TEST_MONGODB_URI: 'mongodb://127.0.0.1/x' }) }), /production/);
  assert.equal(
    resolveLoopbackTestUri({ dbName: 'disposable', env: E({ TEST_MONGODB_URI: 'mongodb://127.0.0.1:27557/ignored?directConnection=true' }) }),
    'mongodb://127.0.0.1:27557/disposable?directConnection=true'
  );
  assert.equal(
    resolveLoopbackTestUri({ dbName: 'd', env: E({ TEST_MONGODB_URI: 'mongodb://localhost/x', MONGODB_URI: 'mongodb://prod.example.net/x' }) }),
    'mongodb://localhost/d'
  );
  // explicit override
  assert.match(
    resolveLoopbackTestUri({ dbName: 'd', env: E({ TEST_MONGODB_URI: 'mongodb://u:p@db.example.net:27017/x', ALLOW_REMOTE_TEST_DB: '1' }) }),
    /db\.example\.net.*\/d$/
  );
  assert.deepEqual(parseHosts('mongodb://u:p@a:1,b:2/db'), ['a', 'b']);
});


// ------------------------------------------------- F1: one ownership rule everywhere --

const fakeFn = (id: string, extra: Record<string, unknown> = {}) => ({
  opts: { id, triggers: [{ event: `ev/${id}` }], ...extra },
  fn: async () => undefined,
});

test('F1: an owned function with an unsupported option stays served by Inngest (never deregistered)', () => {
  const all = [fakeFn('ok-a'), fakeFn('ok-b'), fakeFn('throttled', { throttle: { limit: 1, period: '1m' } })];
  assert.ok(toNativeFunction(all[2]).unsupported?.length, 'fixture must really be unsupported');

  const sel = selectServedFunctions(all, new Set(['ok-a', 'throttled']));
  assert.deepEqual([...sel.owned], ['ok-a']);
  const servedIds = sel.served.map((f) => f.opts.id).sort();
  assert.deepEqual(servedIds, ['ok-b', 'throttled']);
  assert.ok(servedIds.includes('throttled'), 'the unsupported function must remain registered with Inngest');
  assert.ok(!servedIds.includes('ok-a'), 'the valid owned function is released to the worker');
  assert.deepEqual(sel.rejected.map((r) => r.id), ['throttled']);
  assert.match(sel.rejected[0].reason, /unsupported/);
});

test('F1: typos, "*", and uninspectable entries never deregister anything and never throw', () => {
  const all = [fakeFn('a'), { weird: true } as any, fakeFn('b')];
  const sel = selectServedFunctions(all, new Set(['typo', '*', 'a']));
  assert.deepEqual([...sel.owned], ['a']);
  assert.equal(sel.served.length, 2);
  assert.ok(sel.served.includes(all[1]), 'an entry the adapter cannot inspect is kept');
  assert.deepEqual(sel.rejected.map((r) => r.id).sort(), ['*', 'typo']);
  // only typos: nothing owned, everything served
  const none = selectServedFunctions(all, new Set(['nope']));
  assert.equal(none.owned.size, 0);
  assert.equal(none.served.length, 3);
  // nothing requested: identical list returned
  assert.deepEqual(selectServedFunctions(all, new Set()).served, all);
});

test('F1: the route, the ownership endpoint and the router apply identical rules', () => {
  const all = [fakeFn('a'), fakeFn('b'), fakeFn('c', { debounce: { period: '5s' } }), fakeFn('proactive-nba-scheduler')];
  const requested = new Set(['a', 'c', 'ghost']);
  const views = all.map((f) => toNativeFunction(f));

  const fromRoute = selectServedFunctions(all, requested);
  const fromRouter = resolveWebOwnership(views, requested); // what dispatch.getRouter calls
  const payload = buildOwnershipPayload(views, requested, { leadEngineV2: true });

  assert.deepEqual([...fromRoute.owned].sort(), [...fromRouter.owned].sort());
  assert.deepEqual(payload.native.sort(), [...fromRouter.owned].sort());
  assert.deepEqual(payload.rejected.sort(), ['c', 'ghost']);
  // served by Inngest = everything not natively owned
  assert.deepEqual(fromRoute.served.map((f) => f.opts.id).sort(), payload.served.sort());
  assert.ok(payload.served.includes('c'), 'unsupported owned function is still served');
  assert.ok(!payload.native.includes('c'));
});

test('F1: the ownership payload hides proactive-nba-scheduler unless LEAD_ENGINE_V2, like the route', () => {
  const views = [{ id: 'a' }, { id: 'proactive-nba-scheduler' }];
  assert.deepEqual(buildOwnershipPayload(views, new Set(), { leadEngineV2: false }).served, ['a']);
  assert.deepEqual(buildOwnershipPayload(views, new Set(), { leadEngineV2: true }).served, ['a', 'proactive-nba-scheduler']);
});

test('F1: with an unsupported id requested, the worker guard stays BLOCKED (never verified)', async () => {
  const { evaluateOwnership } = await import('../../src/services/jobs/ownershipGuard.ts');
  const views = [{ id: 'a' }, { id: 'c', unsupported: ['opts.throttle'] }];
  const payload = buildOwnershipPayload(views, new Set(['a', 'c']), { leadEngineV2: true });
  const v = evaluateOwnership(payload, new Set(['a', 'c']));
  assert.equal(v.ok, false, 'web did not release c, so the worker must not claim anything');
  assert.deepEqual((v as any).conflicting, ['c']);
});
