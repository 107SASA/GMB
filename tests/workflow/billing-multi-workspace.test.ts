/**
 * One owner, several workspaces, each with its own Razorpay subscription —
 * through the REAL event handler (services/billing/billingEvents.ts) against
 * an in-memory MongoDB. Razorpay is NOT configured (credentials removed), so
 * nothing is contacted.
 *
 * User-level entitlements (Subscription doc + User.subscriptionPlan, read by
 * requireModule and the usage limits) are shared by every workspace the user
 * owns. One workspace ending or failing must not take them away while another
 * workspace of the same owner is still paid for.
 *
 * Run: npm run test:workflow
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST)_/.test(k)) delete process.env[k];

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_multi_workspace_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    Subscription: (await import('../../src/models/Subscription')).default,
    events: await import('../../src/services/billing/billingEvents'),
    applyEntitlements: await import('../../src/lib/billing/applyEntitlements'),
    entitlements: await import('../../src/lib/billing/entitlements'),
  };
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const oid = () => new m.mongoose.Types.ObjectId();
const PERIOD_END = Math.floor(new Date('2027-06-01T00:00:00Z').getTime() / 1000);
let seq = 0;

/** An owner with `count` workspaces (no billing yet). */
async function ownerWithWorkspaces(count: number) {
  const userId = oid();
  const organizationId = oid();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const b = await m.Business.create({ name: `WS ${++seq}`, category: 'Bakery', address: 'Pune', userId, organizationId } as any);
    ids.push(String(b._id));
  }
  await m.User.create({ _id: userId, fullName: `Owner ${seq}`, email: `multi${seq}@example.invalid`, phone: `+9198766${String(seq).padStart(5, '0')}`, role: 'CLIENT', businessIds: ids } as any);
  return { userId: String(userId), businessIds: ids };
}

const paidEntity = (subId: string, businessId: string, userId: string, status: string) => ({
  id: subId, status, plan_id: 'plan_monthly', paid_count: 1, current_end: PERIOD_END,
  notes: { businessId, userId, planType: 'Pro', billingCycle: 'monthly', trial: '0' },
});
const captured = { id: 'pay_x', amount: 199_900, currency: 'INR', status: 'captured' };

async function pay(subId: string, businessId: string, userId: string, at: string) {
  await m.events.applyRazorpayEvent({ type: 'subscription.charged', eventAt: new Date(at), source: 'webhook', subEntity: paidEntity(subId, businessId, userId, 'active'), paymentEntity: { ...captured, id: `pay_${subId}` } });
}

async function userLevel(userId: string) {
  const [sub, user] = await Promise.all([m.Subscription.findOne({ userId }).lean(), m.User.findById(userId).select('subscriptionPlan').lean()]);
  return { sub, plan: user?.subscriptionPlan };
}

test('one workspace cancelled → the owner keeps paid modules for the other, still-paid workspace', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { userId, businessIds: [a, b] } = await ownerWithWorkspaces(2);
  await pay('sub_ma', a, userId, '2027-01-01T00:00:00Z');
  await pay('sub_mb', b, userId, '2027-01-02T00:00:00Z');

  await m.events.applyRazorpayEvent({ type: 'subscription.cancelled', eventAt: new Date('2027-02-01T00:00:00Z'), source: 'webhook', subEntity: paidEntity('sub_mb', b, userId, 'cancelled'), paymentEntity: null });

  assert.equal((await m.Business.findById(b).lean()).subscriptionStatus, 'canceled');
  assert.equal((await m.Business.findById(a).lean()).subscriptionStatus, 'active');
  const { sub, plan } = await userLevel(userId);
  assert.equal(plan, 'Pro', 'usage limits stay on the paid plan while workspace A is paid');
  assert.equal(sub.billingStatus, 'Active');
  assert.equal(m.entitlements.userCanUseModule(sub, 'sales_agent'), true, 'workspace A (paid) must not get MODULE_LOCKED');
});

test('one workspace fails to charge → the other, still-paid workspace is not restricted after the grace period', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { userId, businessIds: [a, b] } = await ownerWithWorkspaces(2);
  await pay('sub_fa', a, userId, '2027-01-01T00:00:00Z');
  await pay('sub_fb', b, userId, '2027-01-02T00:00:00Z');

  await m.events.applyRazorpayEvent({ type: 'subscription.halted', eventAt: new Date('2027-02-01T00:00:00Z'), source: 'webhook', subEntity: paidEntity('sub_fb', b, userId, 'halted'), paymentEntity: null });

  assert.equal((await m.Business.findById(b).lean()).subscriptionStatus, 'past_due');
  const { sub } = await userLevel(userId);
  assert.notEqual(sub.billingStatus, 'PastDue', 'the user-level plan is not failed while workspace A is paid');
  const afterAnyGrace = new Date('2030-01-01T00:00:00Z');
  assert.equal(m.entitlements.userCanUseModule(sub, 'content_studio', afterAnyGrace), true);
});

test('a cancelled trial ending (daily cron path) → the owner keeps paid modules for another paid workspace', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { userId, businessIds: [a, b] } = await ownerWithWorkspaces(2);
  await pay('sub_ta', a, userId, '2027-01-01T00:00:00Z');
  await m.Business.updateOne({ _id: b }, { $set: { subscriptionStatus: 'trial_active', trialEndsAt: new Date('2026-01-01T00:00:00Z'), trialCancelledAt: new Date('2025-12-01T00:00:00Z') } });

  assert.equal(await m.applyEntitlements.userHasOtherPlanWorkspace(userId, b), true);
  await m.applyEntitlements.endUserPlanUnlessOtherWorkspacePaid(userId, b);

  const { sub, plan } = await userLevel(userId);
  assert.equal(plan, 'Pro');
  assert.equal(m.entitlements.userCanUseModule(sub, 'reputation_agent'), true);
});

test('single workspace cancelled → the user-level plan is downgraded exactly as before', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { userId, businessIds: [a] } = await ownerWithWorkspaces(1);
  await pay('sub_sa', a, userId, '2027-01-01T00:00:00Z');
  assert.equal((await userLevel(userId)).plan, 'Pro');

  await m.events.applyRazorpayEvent({ type: 'subscription.cancelled', eventAt: new Date('2027-02-01T00:00:00Z'), source: 'webhook', subEntity: paidEntity('sub_sa', a, userId, 'cancelled'), paymentEntity: null });

  const { sub, plan } = await userLevel(userId);
  assert.equal((await m.Business.findById(a).lean()).subscriptionStatus, 'canceled');
  assert.equal(plan, 'Free');
  assert.equal(sub.billingStatus, 'Canceled');
  assert.equal(m.entitlements.userCanUseModule(sub, 'sales_agent'), false);
});

test('single workspace fails to charge → the user-level plan is marked past due exactly as before', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { userId, businessIds: [a] } = await ownerWithWorkspaces(1);
  await pay('sub_sf', a, userId, '2027-01-01T00:00:00Z');

  await m.events.applyRazorpayEvent({ type: 'subscription.pending', eventAt: new Date('2027-02-01T00:00:00Z'), source: 'webhook', subEntity: paidEntity('sub_sf', a, userId, 'pending'), paymentEntity: null });

  const { sub } = await userLevel(userId);
  assert.equal(sub.billingStatus, 'PastDue');
});

test('the other workspace is unpaid, cancelled, or deleted → it does not keep the plan', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { userId, businessIds: [a, b, c, d] } = await ownerWithWorkspaces(4);
  await m.Business.updateOne({ _id: b }, { $set: { subscriptionStatus: 'canceled' } });
  await m.Business.updateOne({ _id: c }, { $set: { subscriptionStatus: 'active', isDeleted: true } });
  await m.Business.updateOne({ _id: d }, { $set: { subscriptionStatus: 'past_due', paymentGraceEndsAt: new Date('2020-01-01T00:00:00Z') } });
  assert.equal(await m.applyEntitlements.userHasOtherPlanWorkspace(userId, a), false);
});
