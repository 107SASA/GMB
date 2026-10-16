/**
 * A second paid subscription for an already-paid workspace, through the REAL
 * event handler (services/billing/billingEvents.ts → applyRazorpayEvent)
 * against an in-memory MongoDB: the paying subscription is kept, nothing is
 * activated or notified, and the audit event lands in the review queue.
 * No Razorpay or messaging call is reachable on this path.
 *
 * Run: npm run test:workflow
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI)_/.test(k)) delete process.env[k];

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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_dup_sub_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    BillingEvent: (await import('../../src/models/BillingEvent')).default,
    Notification: (await import('../../src/models/Notification')).default,
    events: await import('../../src/services/billing/billingEvents'),
  };
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

async function paidWorkspace(over: Record<string, unknown> = {}) {
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({
    name: 'Asha Bakery', category: 'Bakery', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(),
    subscriptionStatus: 'active', billingSubscriptionId: 'sub_a', razorpaySubscriptionId: 'sub_a',
    subscriptionCurrentPeriodEnd: new Date('2027-04-01'), ...over,
  } as any);
  return { businessId: String(b._id), userId: String(userId) };
}

const chargedEvent = (businessId: string, userId: string, subId: string) => ({
  type: 'subscription.charged',
  eventAt: new Date('2027-03-01T10:00:00Z'),
  source: 'webhook' as const,
  razorpayEventId: `evt_${subId}_${Date.now()}`,
  subEntity: { id: subId, status: 'active', plan_id: 'plan_m', paid_count: 1, current_end: 1806000000, notes: { businessId, userId, planType: 'Pro', trial: '0' } },
  paymentEntity: { id: 'pay_1', amount: 499900, currency: 'INR', status: 'captured' },
});

test('second paid subscription → paying subscription kept, no activation side effects, event flagged for review', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await paidWorkspace();

  const r = await m.events.applyRazorpayEvent(chargedEvent(businessId, userId, 'sub_b'));
  assert.deepEqual(r.decision.actions.map((a: any) => a.kind), ['flag_duplicate_subscription']);

  const after: any = await m.Business.findById(businessId).lean();
  assert.equal(after.billingSubscriptionId, 'sub_a', 'the original stays the paying subscription');
  assert.equal(after.subscriptionStatus, 'active');
  assert.equal(await m.Notification.countDocuments({ businessId }), 0, 'no "subscription activated" notice');

  const ev: any = await m.BillingEvent.findOne({ businessId, razorpaySubscriptionId: 'sub_b' }).lean();
  assert.equal(ev.needsReview, true, 'listed in the Super Admin review queue');
  assert.deepEqual(ev.actions, ['flag_duplicate_subscription']);
  assert.match(ev.note, /double charge/);
});

test('cancel-at-period-end loaded from the workspace: a resubscription is not flagged', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await paidWorkspace({ subscriptionCancelAtPeriodEnd: true, razorpaySubscriptionId: 'sub_b' });
  const facts: any = await m.Business.findById(businessId).select('subscriptionCancelAtPeriodEnd').lean();
  assert.equal(facts.subscriptionCancelAtPeriodEnd, true);
  const { decideBillingEvent } = await import('../../src/lib/billing/subscriptionMachine');
  // Same facts the handler builds (decision only — activation side effects are covered elsewhere).
  const d = decideBillingEvent({
    type: 'subscription.charged', eventAt: new Date(), payment: { amount: 499900, currency: 'INR', status: 'captured' }, claim: null, expectedPaidAmountPaise: null,
    sub: { id: 'sub_b', status: 'active', planId: 'plan_m', startAt: null, currentEnd: null, paidCount: 1, isTrial: false },
    workspace: { id: businessId, subscriptionStatus: 'active', billingSubscriptionId: 'sub_a', razorpaySubscriptionId: 'sub_b', trialEndsAt: null, trialCancelledAt: null, billingLastEventAt: null, subscriptionCancelAtPeriodEnd: facts.subscriptionCancelAtPeriodEnd },
  });
  assert.deepEqual(d.actions.map((a) => a.kind), ['activate_paid']);
  void userId;
});
