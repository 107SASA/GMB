/**
 * Trial / AutoPay lifecycle through the REAL event handler
 * (services/billing/billingEvents.ts → applyRazorpayEvent) against an
 * in-memory MongoDB. Razorpay is NOT configured here (credentials removed), so
 * any Razorpay call takes its "unavailable" path — nothing is contacted.
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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_lifecycle_wiring_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    BillingEvent: (await import('../../src/models/BillingEvent')).default,
    TrialClaim: (await import('../../src/models/TrialClaim')).default,
    Notification: (await import('../../src/models/Notification')).default,
    User: (await import('../../src/models/User')).default,
    Subscription: (await import('../../src/models/Subscription')).default,
    events: await import('../../src/services/billing/billingEvents'),
    verification: await import('../../src/services/billing/trialChargeVerification'),
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
const TRIAL_END = new Date('2027-04-15T10:00:00Z');
const AMOUNT = 999_900;
let seq = 0;

async function workspace(over: Record<string, unknown> = {}) {
  const userId = oid();
  const b = await m.Business.create({ name: `WS ${++seq}`, category: 'Bakery', address: 'Pune', userId, organizationId: oid(), ...over } as any);
  // A real owner, so in-app notices are actually delivered (and can be asserted).
  await m.User.create({ _id: userId, fullName: `Owner ${seq}`, email: `owner${seq}@example.invalid`, phone: `+9198765${String(seq).padStart(5, '0')}`, role: 'CLIENT', businessIds: [b._id] } as any);
  return { businessId: String(b._id), userId: String(userId) };
}

const trialEntity = (subId: string, businessId: string, userId: string, status: string) => ({
  id: subId, status, plan_id: 'plan_yearly', paid_count: 0, start_at: Math.floor(TRIAL_END.getTime() / 1000),
  notes: { businessId, userId, planType: 'Pro', trial: '1' },
});

test('cancellation delivered before authorization → the trial is used and cancelled, never left running', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace({ razorpaySubscriptionId: 'sub_t1' });
  await m.TrialClaim.create({
    phoneHash: `hash_${Date.now()}`, status: 'reserved', userId, businessId, holderBusinessId: businessId, razorpaySubscriptionId: 'sub_t1',
    reservedAt: new Date(), reservedUntil: new Date(Date.now() + 86_400_000),
    offer: { trialMonths: 3, trialEndsAt: TRIAL_END, razorpayPlanId: 'plan_yearly', amountPaise: AMOUNT, currency: 'INR', policyVersion: 1, decidedAt: new Date() },
  } as any);

  await m.events.applyRazorpayEvent({ type: 'subscription.cancelled', eventAt: new Date('2027-01-15T10:02:00Z'), source: 'webhook', subEntity: trialEntity('sub_t1', businessId, userId, 'cancelled'), paymentEntity: null });
  let claim: any = await m.TrialClaim.findOne({ razorpaySubscriptionId: 'sub_t1' }).lean();
  assert.ok(claim.subscriptionEndedAt, 'the end is remembered on the claim');
  assert.equal(claim.status, 'reserved', 'Razorpay unavailable → the claim is never released on a guess');

  await m.events.applyRazorpayEvent({ type: 'subscription.authenticated', eventAt: new Date('2027-01-15T10:01:00Z'), source: 'webhook', subEntity: trialEntity('sub_t1', businessId, userId, 'authenticated'), paymentEntity: null });
  const ws: any = await m.Business.findById(businessId).lean();
  assert.equal(ws.subscriptionStatus, 'trial_active');
  assert.ok(ws.trialCancelledAt, 'started as cancelled — no charge expected, access only to the trial end');
  assert.equal(new Date(ws.trialEndsAt).toISOString(), TRIAL_END.toISOString());
  claim = await m.TrialClaim.findOne({ razorpaySubscriptionId: 'sub_t1' }).lean();
  assert.equal(claim.status, 'consumed', 'the phone has used its one trial');

  // Notices: never "Free trial started" for a trial that starts cancelled.
  const notices: any[] = await m.Notification.find({ businessId }).lean();
  assert.equal(notices.filter((n) => n.type === 'billing_trial_started' || /trial started/i.test(n.title)).length, 0, 'no "Free trial started"');
  const cancelledNotice = notices.find((n) => n.type === 'billing_trial_cancelled');
  assert.ok(cancelledNotice, 'an accurate "Free trial cancelled" notice instead');
  assert.match(cancelledNotice.body, /won't be charged/);
  // User-level trial ends exactly at the trial end (no first-charge window).
  const sub: any = await m.Subscription.findOne({ userId }).lean();
  assert.equal(new Date(sub.trialStatus.endsAt).toISOString(), TRIAL_END.toISOString());
});

test('claim already settled as used, then cancellation before authorization → started cancelled, no "Free trial started"', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace({ razorpaySubscriptionId: 'sub_t3' });
  // A later checkout settled the reservation against Razorpay (authorized) before
  // the authorization webhook was processed: the claim is consumed, no trial yet.
  await m.TrialClaim.create({
    phoneHash: `hash3_${Date.now()}`, status: 'consumed', userId, businessId, razorpaySubscriptionId: 'sub_t3',
    reservedAt: new Date(), reservedUntil: new Date(Date.now() - 1000), consumedAt: new Date(),
    offer: { trialMonths: 3, trialEndsAt: TRIAL_END, razorpayPlanId: 'plan_yearly', amountPaise: AMOUNT, currency: 'INR', policyVersion: 1, decidedAt: new Date() },
  } as any);

  await m.events.applyRazorpayEvent({ type: 'subscription.cancelled', eventAt: new Date('2027-01-15T10:02:00Z'), source: 'webhook', subEntity: trialEntity('sub_t3', businessId, userId, 'cancelled'), paymentEntity: null });
  const claim: any = await m.TrialClaim.findOne({ razorpaySubscriptionId: 'sub_t3' }).lean();
  assert.ok(claim.subscriptionEndedAt, 'the end is remembered even though the claim is already consumed');

  await m.events.applyRazorpayEvent({ type: 'subscription.authenticated', eventAt: new Date('2027-01-15T10:01:00Z'), source: 'webhook', subEntity: trialEntity('sub_t3', businessId, userId, 'authenticated'), paymentEntity: null });
  const ws: any = await m.Business.findById(businessId).lean();
  assert.equal(ws.subscriptionStatus, 'trial_active');
  assert.ok(ws.trialCancelledAt, 'started as cancelled — no charge expected');
  assert.equal(await m.Notification.countDocuments({ businessId, type: 'billing_trial_started' }), 0, 'no "Free trial started"');
  assert.equal(await m.Notification.countDocuments({ businessId, type: 'billing_trial_cancelled' }), 1, 'one "Free trial cancelled" notice');
});

test('an in-order authorization still sends "Free trial started"', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace({ razorpaySubscriptionId: 'sub_t2' });
  await m.TrialClaim.create({
    phoneHash: `hash2_${Date.now()}`, status: 'reserved', userId, businessId, holderBusinessId: businessId, razorpaySubscriptionId: 'sub_t2',
    reservedAt: new Date(), reservedUntil: new Date(Date.now() + 86_400_000),
    offer: { trialMonths: 3, trialEndsAt: TRIAL_END, razorpayPlanId: 'plan_yearly', amountPaise: AMOUNT, currency: 'INR', policyVersion: 1, decidedAt: new Date() },
  } as any);
  await m.events.applyRazorpayEvent({ type: 'subscription.authenticated', eventAt: new Date(), source: 'webhook', subEntity: trialEntity('sub_t2', businessId, userId, 'authenticated'), paymentEntity: null });
  const ws: any = await m.Business.findById(businessId).lean();
  assert.equal(ws.subscriptionStatus, 'trial_active');
  assert.equal(ws.trialCancelledAt, undefined);
  assert.equal(await m.Notification.countDocuments({ businessId, type: 'billing_trial_started' }), 1);
  assert.equal(await m.Notification.countDocuments({ businessId, type: 'billing_trial_cancelled' }), 0);
});

test('a repeat failure for an already-open failure: no new Day 0; the self-heal does not record it again, a webhook does', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const failedAt = new Date('2027-02-01T10:00:00Z');
  const { businessId, userId } = await workspace({
    subscriptionStatus: 'past_due', billingSubscriptionId: 'sub_p', razorpaySubscriptionId: 'sub_p',
    paymentFailedAt: failedAt, paymentFailureReason: 'charge_failed', paymentGraceEndsAt: new Date('2027-02-04T10:00:00Z'),
  });
  const sub = (status: string) => ({ id: 'sub_p', status, plan_id: 'plan_m', paid_count: 3, notes: { businessId, userId, planType: 'Pro', trial: '0' } });

  for (let i = 0; i < 3; i++) {
    await m.events.applyRazorpayEvent({ type: 'subscription.pending', eventAt: new Date(), source: 'reconcile', subEntity: sub('pending'), paymentEntity: null });
  }
  assert.equal(await m.BillingEvent.countDocuments({ businessId }), 0, 'unchanged state is not re-recorded every 30 minutes');

  await m.events.applyRazorpayEvent({ type: 'subscription.halted', eventAt: new Date('2027-02-05T10:00:00Z'), source: 'webhook', subEntity: sub('halted'), paymentEntity: null });
  const ws: any = await m.Business.findById(businessId).lean();
  assert.equal(new Date(ws.paymentFailedAt).toISOString(), failedAt.toISOString(), 'Day 0 stays frozen');
  assert.equal(new Date(ws.paymentGraceEndsAt).toISOString(), '2027-02-04T10:00:00.000Z', 'grace unchanged');
  assert.equal(ws.paymentFailureReason, 'retries_exhausted');
  assert.equal(await m.BillingEvent.countDocuments({ businessId, source: 'webhook' }), 1, 'each webhook is still audited');
});

test('a captured charge that fails verification: no access change, flagged for review', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace({ subscriptionStatus: 'trialing', razorpaySubscriptionId: 'sub_x' });
  await m.events.applyRazorpayEvent({
    type: 'subscription.charged', eventAt: new Date(), source: 'webhook',
    subEntity: { id: 'sub_x', status: 'active', plan_id: 'plan_yearly', paid_count: 1, notes: { businessId, userId, planType: 'Pro', trial: '1' } },
    paymentEntity: { id: 'pay_x', amount: AMOUNT, currency: 'INR', status: 'captured' },
  });
  const ws: any = await m.Business.findById(businessId).lean();
  assert.equal(ws.subscriptionStatus, 'trialing', 'no snapshot → never paid access');
  const ev: any = await m.BillingEvent.findOne({ businessId }).lean();
  assert.equal(ev.needsReview, true);
  assert.match(ev.note, /captured payment not accepted/);
});

test('an unconfirmed trial charge is flagged once per open case, never as paid or failed', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace({ subscriptionStatus: 'trial_active', trialEndsAt: new Date('2027-01-01') });
  const check = { attempted: true, activated: false, reason: 'razorpay fetch failed' };
  assert.equal(await m.verification.flagUnconfirmedTrialCharge(businessId, userId, check), true);
  assert.equal(await m.verification.flagUnconfirmedTrialCharge(businessId, userId, check), false, 'the daily re-check does not repeat it');
  const ws: any = await m.Business.findById(businessId).lean();
  assert.equal(ws.subscriptionStatus, 'trial_active', 'not marked past due or paid');
  assert.equal(ws.paymentFailedAt, undefined);
});
