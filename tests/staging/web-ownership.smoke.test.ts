/**
 * H1 regression, web path: a typo in JOBS_NATIVE_FUNCTIONS must NEVER take down
 * /api/inngest or fail event sends. Uses the real registry + dispatch code on a
 * disposable loopback database. Run via `npm run test:jobs:smoke`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const DB_NAME = `web_owner_${Date.now().toString(36)}`;
let mongoose: any;
let db: any;
const errors: string[] = [];
const realError = console.error;

before(async () => {
  const { resolveLoopbackTestUri } = await import('../../scripts/lib/loopbackTestDb.mjs');
  process.env.MONGODB_URI = resolveLoopbackTestUri({ dbName: DB_NAME });
  (process.env as any).NODE_ENV = 'test';
  process.env.JOBS_NATIVE_ENABLED = 'true';
  // one valid id (event-less cron, so it never needs the queue) plus a typo and a wildcard
  process.env.JOBS_NATIVE_FUNCTIONS = 'cleanup-stale-pending-audits, typo-fn-id, *';
  process.env.JOBS_COLLECTION_PREFIX = 'webown_';
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };

  mongoose = (await import('mongoose')).default;
  const dbConnect = (await import('../../src/lib/mongodb')).default;
  await dbConnect();
  db = mongoose.connection.db;
  assert.equal(db.databaseName, DB_NAME);
});

after(async () => {
  console.error = realError;
  if (db?.databaseName === DB_NAME) await db.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});

test('H1: getRouter resolves with only the valid id owned; bad ids are logged, not thrown', async () => {
  const { getRouter, nativeRoutingActive } = await import('../../src/services/jobs/dispatch');
  assert.equal(nativeRoutingActive(), true);
  const r = await getRouter();
  assert.deepEqual([...r.owned], ['cleanup-stale-pending-audits']);
  assert.ok(errors.some((e) => /typo-fn-id/.test(e)), `expected a loud log, got: ${errors.join(' | ')}`);
});

test('H1: event sends for Inngest-owned functions still go to Inngest while a typo is configured', async () => {
  const { routeSend } = await import('../../src/services/jobs/dispatch');
  const forwarded: any[] = [];
  const out = await routeSend(
    [{ name: 'whatsapp/incoming', data: { messageSid: 'SM1', from: 'whatsapp:+910000000000', body: 'hi' } }],
    async (p: any) => { forwarded.push(p); return { ids: ['inngest'] }; }
  );
  assert.equal(forwarded.length, 1, 'the event must be forwarded to Inngest, not rejected');
  assert.equal(forwarded[0][0].name, 'whatsapp/incoming');
  assert.equal(out.ids.length, 1);
});

test('H1: the /api/inngest route module loads and serves with a typo configured', async () => {
  const mod: any = await import('../../src/app/api/inngest/route');
  assert.equal(typeof mod.GET, 'function');
  assert.equal(typeof mod.PUT, 'function');
  assert.ok(
    errors.some((e) => /typo-fn-id/.test(e) && /ignored on the web path/.test(e) && /Inngest keeps serving it/.test(e)),
    `expected a per-id log naming the typo, got: ${errors.join(' | ')}`
  );
});

test('H1: the worker-side validation is still fail-closed for the same input', async () => {
  const { loadRegistry } = await import('../../src/services/jobs/dispatch');
  const { assertOwnable } = await import('../../src/services/jobs/adapter');
  const { nativeFunctionIdsStrict } = await import('../../src/services/jobs/config');
  const fns = await loadRegistry();
  assert.throws(() => nativeFunctionIdsStrict(), /explicit function ids/);
  assert.throws(() => assertOwnable(fns, new Set(['cleanup-stale-pending-audits', 'typo-fn-id'])), /unknown function id/);
});

test('F1: the ownership endpoint reports exactly the ownership the router uses', async () => {
  process.env.JOBS_GUARD_TOKEN = 'smoke-test-token';
  const { GET } = await import('../../src/app/api/inngest/ownership/route');
  const { getRouter } = await import('../../src/services/jobs/dispatch');

  const unauth = await GET(new Request('http://localhost/api/inngest/ownership', { headers: { authorization: 'Bearer wrong' } }) as any);
  assert.equal(unauth.status, 401);

  const res = await GET(new Request('http://localhost/api/inngest/ownership', { headers: { authorization: 'Bearer smoke-test-token' } }) as any);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  const router = await getRouter();

  assert.deepEqual(body.native, [...router.owned].sort());
  assert.deepEqual(body.native, ['cleanup-stale-pending-audits']);
  assert.ok(body.rejected.includes('typo-fn-id'));
  assert.ok(!body.served.includes('cleanup-stale-pending-audits'), 'owned function is released to the worker');
  assert.ok(body.served.includes('process-whatsapp-message'), 'every other function stays with Inngest');
  // every known function is served by Inngest or owned natively; the flag-gated scheduler is the one exception
  assert.equal(body.served.length + body.native.length + (process.env.LEAD_ENGINE_V2 === 'true' ? 0 : 1), body.known.length);
});
