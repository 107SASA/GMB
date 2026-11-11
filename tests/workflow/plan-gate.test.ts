/**
 * Per-workspace paid access for API routes (src/lib/planGate.ts), against a
 * real in-memory MongoDB: every billing state a workspace can be in.
 *
 * Run with: npm run test:workflow
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
const ws: Record<string, string> = {};
let ownerId = '';
let adminId = '';

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_plan_gate_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    gate: await import('../../src/lib/planGate'),
  };
  const db = m.mongoose.connection.db;
  const oid = () => new m.mongoose.Types.ObjectId();
  const owner = oid();
  const admin = oid();
  ownerId = String(owner);
  adminId = String(admin);
  await db.collection('users').insertMany([
    { _id: owner, role: 'CLIENT', subscriptionPlan: 'Pro', email: 'o@example.com' },
    { _id: admin, role: 'SUPER_ADMIN', email: 'a@example.com' },
  ]);
  const day = 86_400_000;
  const now = Date.now();
  const states: Record<string, Record<string, unknown>> = {
    active: { subscriptionStatus: 'active' },
    held: { subscriptionStatus: 'active', paymentAccessHold: true },
    trial: { subscriptionStatus: 'trial_active', trialEndsAt: new Date(now + 10 * day) },
    trialNoEnd: { subscriptionStatus: 'trial_active' },
    grace: { subscriptionStatus: 'past_due', paymentGraceEndsAt: new Date(now + day) },
    restrictedSome: { subscriptionStatus: 'past_due', paymentGraceEndsAt: new Date(now - day), paymentRestrictedModules: ['marketing_automation'] },
    restrictedAll: { subscriptionStatus: 'past_due', paymentGraceEndsAt: new Date(now - day) },
    unpaid: { subscriptionStatus: 'trialing' },
    canceled: { subscriptionStatus: 'canceled' },
    legacy: { subscriptionStatus: 'trialing', createdAt: new Date('2026-03-01') },
  };
  for (const [key, fields] of Object.entries(states)) {
    const id = oid();
    await db.collection('businesses').insertOne({ _id: id, name: key, userId: owner, createdAt: new Date(), isDeleted: false, ...fields });
    ws[key] = String(id);
  }
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const allowed = async (key: string, module?: string, caller = ownerId) => (await m.gate.requireWorkspacePlan(caller, ws[key], module)).ok;

test('paid, trial and grace workspaces can use paid features', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal(await allowed('active'), true);
  assert.equal(await allowed('trial'), true);
  assert.equal(await allowed('grace'), true);
  assert.equal(await allowed('legacy'), true, 'pre-July workspace on a paid user plan keeps access');
});

test('unpaid, cancelled, held and broken-trial workspaces are locked', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal(await allowed('unpaid'), false);
  assert.equal(await allowed('canceled'), false);
  assert.equal(await allowed('held'), false);
  assert.equal(await allowed('trialNoEnd'), false);
  const res = await m.gate.requireWorkspacePlan(ownerId, ws.unpaid);
  assert.equal(res.response.status, 403);
  assert.equal((await res.response.json()).error, 'MODULE_LOCKED', 'same shape the web and mobile clients handle');
});

test('failed payment after grace: only the restricted modules are locked', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal(await allowed('restrictedSome', 'marketing_automation'), false);
  assert.equal(await allowed('restrictedSome', 'content_studio'), true);
  assert.equal(await allowed('restrictedSome'), true, 'route without a module: some paid modules are still open');
  assert.equal(await allowed('restrictedAll', 'content_studio'), false);
  assert.equal(await allowed('restrictedAll'), false);
});

test('a super admin caller (support, "Login as customer") is never locked', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal(await allowed('unpaid', undefined, adminId), true);
});

test('an unknown workspace is locked', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal((await m.gate.requireWorkspacePlan(ownerId, String(new m.mongoose.Types.ObjectId()))).ok, false);
});
