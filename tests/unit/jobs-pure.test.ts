/**
 * Pure unit tests for the native job queue helpers — no DB, no aliases.
 * Run: node --test tests/unit/jobs-pure.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs, cronMatches, parseCron, parseDurationMs, slotsBetween } from '../../src/services/jobs/time.ts';
import { isNativeEnabled, nativeFunctionIds, partitionOwnership, workerTuning } from '../../src/services/jobs/config.ts';
import { assertOwnable, INNGEST_DEFAULT_RETRIES, isInngestFunction, toNativeFunction } from '../../src/services/jobs/adapter.ts';

const D = (iso: string) => new Date(iso).getTime();

test('flags: everything is OFF by default', () => {
  const env = {} as NodeJS.ProcessEnv;
  assert.equal(isNativeEnabled(env), false);
  assert.equal(nativeFunctionIds(env).size, 0);
  // function list alone must not enable anything without the master switch
  assert.equal(nativeFunctionIds({ JOBS_NATIVE_FUNCTIONS: 'a,b' } as any).size, 0);
  assert.equal(nativeFunctionIds({ JOBS_NATIVE_ENABLED: 'true', JOBS_NATIVE_FUNCTIONS: 'a, b' } as any).size, 2);
  assert.throws(() => nativeFunctionIds({ JOBS_NATIVE_ENABLED: 'true', JOBS_NATIVE_FUNCTIONS: '*' } as any));
});

test('tuning: clamps and heartbeat stays under a third of the lease', () => {
  const t = workerTuning({ JOBS_LEASE_MS: '6000', JOBS_HEARTBEAT_MS: '60000', JOBS_CONCURRENCY: '999' } as any);
  assert.equal(t.concurrency, 20);
  assert.ok(t.heartbeatMs <= t.leaseMs / 3);
});

test('parseDurationMs', () => {
  assert.equal(parseDurationMs('15s'), 15_000);
  assert.equal(parseDurationMs('5m'), 300_000);
  assert.equal(parseDurationMs('2 hours'), 7_200_000);
  assert.equal(parseDurationMs('3d'), 3 * 86_400_000);
  assert.equal(parseDurationMs(1500), 1500);
  assert.throws(() => parseDurationMs('soon'));
  assert.throws(() => parseDurationMs(-1));
});

test('backoff is exponential, capped, jittered within bounds', () => {
  const mid = () => 0.5; // spread factor exactly 1.0
  assert.equal(backoffMs(1, { rand: mid }), 30_000);
  assert.equal(backoffMs(2, { rand: mid }), 60_000);
  assert.equal(backoffMs(3, { rand: mid }), 120_000);
  assert.equal(backoffMs(30, { rand: mid }), 60 * 60_000); // cap
  for (let i = 0; i < 50; i++) {
    const v = backoffMs(3);
    assert.ok(v >= 96_000 && v <= 144_000, `jitter out of range: ${v}`);
  }
});

test('cron: every production schedule shape parses and matches', () => {
  for (const e of ['0 * * * *', '0 8 * * *', '0 13 * * 0', '*/30 * * * *', '*/15 * * * *', '*/10 * * * *', '30 13 * * *', '0 12 * * 1', '0 */6 * * *', '15 3 * * *']) {
    assert.doesNotThrow(() => parseCron(e), e);
  }
  const everyHour = parseCron('0 * * * *');
  assert.equal(cronMatches(everyHour, new Date('2026-10-13T05:00:00Z')), true);
  assert.equal(cronMatches(everyHour, new Date('2026-10-13T05:01:00Z')), false);
  const sunday = parseCron('0 13 * * 0');
  assert.equal(cronMatches(sunday, new Date('2026-10-18T13:00:00Z')), true); // a Sunday
  assert.equal(cronMatches(sunday, new Date('2026-10-19T13:00:00Z')), false);
  assert.equal(cronMatches(parseCron('0 0 * * 7'), new Date('2026-10-18T00:00:00Z')), true); // 7 == Sunday
  assert.throws(() => parseCron('TZ=Asia/Kolkata 0 * * * *'));
  assert.throws(() => parseCron('0 0 * *'));
  assert.throws(() => parseCron('61 * * * *'));
});

test('slotsBetween: exclusive of start, inclusive of end, capped', () => {
  const spec = parseCron('*/15 * * * *');
  const s = slotsBetween(spec, D('2026-10-13T10:00:00Z'), D('2026-10-13T11:00:00Z'));
  assert.deepEqual(s.map((t) => new Date(t).toISOString().slice(11, 16)), ['10:15', '10:30', '10:45', '11:00']);
  assert.equal(slotsBetween(spec, D('2026-10-13T10:00:00Z'), D('2026-10-13T10:14:59Z')).length, 0);
  assert.equal(slotsBetween(parseCron('* * * * *'), 0, D('2026-10-13T00:00:00Z'), 5).length, 5);
});

// ----- adapter: shapes copied from the real functions in functions.ts -----

const fake = (opts: any) => ({ opts, fn: async () => 'ok' });

test('adapter: default retries, event+cron triggers, cancelOn (scheduleSinglePostPublish shape)', () => {
  const f = toNativeFunction(
    fake({
      id: 'schedule-single-post-publish',
      triggers: [{ event: 'scheduler/post-scheduled' }],
      cancelOn: [
        { event: 'scheduler/post-scheduled', if: 'async.data.postId == event.data.postId' },
        { event: 'scheduler/post-unscheduled', if: 'async.data.postId == event.data.postId' },
      ],
    })
  );
  assert.equal(f.maxAttempts, INNGEST_DEFAULT_RETRIES + 1);
  assert.deepEqual(f.events, ['scheduler/post-scheduled']);
  assert.deepEqual(f.cancelOn, [
    { event: 'scheduler/post-scheduled', field: 'postId' },
    { event: 'scheduler/post-unscheduled', field: 'postId' },
  ]);
  assert.equal(f.unsupported, undefined);
});

test('adapter: keyed concurrency (gbpSyncWorker shape) and explicit retries', () => {
  const f = toNativeFunction(
    fake({
      id: 'gbp-sync-worker',
      retries: 2,
      triggers: [{ event: 'gbp/sync.requested' }],
      concurrency: [{ limit: 5 }, { key: 'event.data.businessId', limit: 1 }],
    })
  );
  assert.equal(f.maxAttempts, 3);
  assert.equal(f.concurrencyLimit, 5);
  assert.equal(f.concurrencyKeyPath, 'event.data.businessId');
  const dual = toNativeFunction(fake({ id: 'account-hard-purge', retries: 1, triggers: [{ cron: '45 3 * * *' }, { event: 'account/purge.requested' }] }));
  assert.deepEqual(dual.crons, ['45 3 * * *']);
  assert.deepEqual(dual.events, ['account/purge.requested']);
});

test('adapter: unsupported options fail closed via assertOwnable', () => {
  const ok = toNativeFunction(fake({ id: 'ok', triggers: [{ event: 'a' }] }));
  const bad = toNativeFunction(fake({ id: 'bad', triggers: [{ event: 'a' }], throttle: { limit: 1, period: '1m' }, cancelOn: [{ event: 'x', if: 'event.data.a > 3' }] }));
  assert.ok(bad.unsupported && bad.unsupported.length >= 2);
  assert.doesNotThrow(() => assertOwnable([ok, bad], new Set(['ok'])));
  assert.throws(() => assertOwnable([ok, bad], new Set(['bad'])), /cannot be natively owned/);
  assert.throws(() => assertOwnable([ok, bad], new Set(['nope'])), /unknown function id/);
});

test('adapter: isInngestFunction duck-typing', () => {
  assert.equal(isInngestFunction(fake({ id: 'x' })), true);
  assert.equal(isInngestFunction({ opts: { id: 'x' } }), false);
  assert.equal(isInngestFunction(null), false);
});

test('ownership: every function has exactly one owner; flag off => Inngest owns all', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const off = partitionOwnership(ids, {} as any);
  assert.deepEqual(off.inngest, ids);
  assert.deepEqual(off.native, []);
  // list without master switch must not move anything
  assert.deepEqual(partitionOwnership(ids, { JOBS_NATIVE_FUNCTIONS: 'a,b' } as any).native, []);

  const on = partitionOwnership(ids, { JOBS_NATIVE_ENABLED: 'true', JOBS_NATIVE_FUNCTIONS: 'b,d' } as any);
  assert.deepEqual(on.native, ['b', 'd']);
  assert.deepEqual(on.inngest, ['a', 'c']);
  assert.equal(on.inngest.filter((i) => on.native.includes(i)).length, 0, 'never both');
  assert.equal(on.inngest.length + on.native.length, ids.length, 'never neither');
});

test('ownership: a typo in JOBS_NATIVE_FUNCTIONS is reported, not silently ignored', () => {
  const r = partitionOwnership(['a', 'b'], { JOBS_NATIVE_ENABLED: 'true', JOBS_NATIVE_FUNCTIONS: 'a,publsh-typo' } as any);
  assert.deepEqual(r.unknown, ['publsh-typo']);
  assert.deepEqual(r.native, ['a']);
});

test('ownership: the real 50 production function ids all resolve to exactly one owner', async () => {
  // ids come from the inventory fixture generated by `npm run jobs:inventory`
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('src/services/inngest/functions.ts', 'utf8');
  const ids = src
    .split(/inngest\.createFunction\(/)
    .slice(1)
    .map((blk) => blk.match(/\bid:\s*["']([^"']+)["']/)?.[1] as string);
  assert.ok(ids.length >= 50, `expected >=50 function ids, got ${ids.length}`);
  assert.equal(new Set(ids).size, ids.length, 'function ids must be unique');
  const half = ids.slice(0, 7).join(',');
  const r = partitionOwnership(ids, { JOBS_NATIVE_ENABLED: 'true', JOBS_NATIVE_FUNCTIONS: half } as any);
  assert.equal(r.native.length, 7);
  assert.equal(r.inngest.length, ids.length - 7);
  assert.deepEqual(r.unknown, []);
});
