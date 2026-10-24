/**
 * Segment 2 — subscription & billing WhatsApp notices, through the REAL
 * Razorpay event handler (services/billing/billingEvents.ts →
 * applyRazorpayEvent) and, for the daily subscription job, the Inngest SDK's
 * own execution engine (tests/helpers/inngestReplay.ts). In-memory MongoDB;
 * WhatsApp delivery mocked by the existing suppression switch (each send is a
 * MessageQueue row; no provider contacted); Razorpay unconfigured (nothing
 * is called); inngest.send captured.
 *
 * Run: npx tsx --test tests/workflow/billing-whatsapp.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runDurably } from '../helpers/inngestReplay';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|LEAD_ENGINE|NEXT_PUBLIC_ANDROID)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
process.env.GROQ_API_KEY = 'test-unused';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:9';
process.env.WHATSAPP_PROVIDER = 'twilio';
process.env.TWILIO_TEMPLATE_NOTIFICATION = 'HXnotification_test';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';

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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_billing_whatsapp_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async () => ({ ids: [] });
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    Subscription: (await import('../../src/models/Subscription')).default,
    TrialClaim: (await import('../../src/models/TrialClaim')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
    SalesConversation: (await import('../../src/models/SalesConversation')).default,
    BillingRecoveryEpisode: (await import('../../src/models/BillingRecoveryEpisode')).default,
    events: await import('../../src/services/billing/billingEvents'),
    notices: await import('../../src/services/billing/billingWhatsApp'),
    recovery: await import('../../src/services/billing/recoveryRemindersService'),
    templates: await import('../../src/lib/whatsappTemplates'),
    fns: await import('../../src/services/inngest/functions'),
  };
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const DAY = 86_400_000;
let seq = 0;
let clock = Date.now();
const nextAt = () => new Date((clock += 60_000));

async function workspace(over: Record<string, unknown> = {}) {
  const n = ++seq;
  const userId = new m.mongoose.Types.ObjectId();
  const phone = `+9198774${String(n).padStart(5, '0')}`;
  const b = await m.Business.create({ name: `Studio ${n}`, category: 'Salon', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(), razorpaySubscriptionId: `sub_${n}`, ...over } as any);
  await m.User.create({ _id: userId, fullName: `Owner ${n}`, email: `b${n}@example.invalid`, phone, role: 'CLIENT', businessIds: [b._id] } as any);
  return { businessId: String(b._id), userId: String(userId), phone, subId: `sub_${n}` };
}

const subEntity = (w: any, over: Record<string, unknown> = {}) => ({
  id: w.subId, status: 'active', plan_id: 'plan_yearly', paid_count: 1, current_end: Math.floor((Date.now() + 365 * DAY) / 1000),
  notes: { businessId: w.businessId, userId: w.userId, planType: 'Pro', billingCycle: 'yearly', trial: '0' }, ...over,
});
const captured = (id = `pay_${++seq}`) => ({ id, status: 'captured', amount: 999_900, currency: 'INR' });
const apply = (type: string, sub: any, payment: any, source: 'webhook' | 'reconcile' = 'webhook') =>
  m.events.applyRazorpayEvent({ type, eventAt: nextAt(), source, subEntity: sub, paymentEntity: payment });

const rows = (phone: string) => m.MessageQueue.find({ 'payload.phone': phone }).sort({ createdAt: 1 }).lean();
const count = (phone: string) => m.MessageQueue.countDocuments({ 'payload.phone': phone });
const textOf = (row: any) => row.payload.body || row.payload.variables?.['2'] || '';

test('first payment: exactly one confirmation with the plan name — activated + charged for the same charge, retries and reconciliation add nothing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  const pay = captured();
  await apply('subscription.activated', subEntity(w), pay);
  await apply('subscription.charged', subEntity(w), pay);          // same first charge (paid_count 1) — not a renewal
  await apply('subscription.charged', subEntity(w), pay);          // webhook retry
  await apply('subscription.charged', subEntity(w), pay, 'reconcile');
  const sent = await rows(w.phone);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /your payment was successful and your GrowwMatics AI \(Yearly\) subscription is now active/);
  assert.doesNotMatch(textOf(sent[0]), /renewed/);
  assert.equal((await m.Business.findById(w.businessId).lean()).subscriptionStatus, 'active');
});

test('renewal: one renewal confirmation per genuine recurring charge (paid_count), duplicates and an out-of-order old charge add nothing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  const first = captured();
  await apply('subscription.activated', subEntity(w), first);
  const renewal = captured();
  await apply('subscription.charged', subEntity(w, { paid_count: 2 }), renewal);
  await apply('subscription.charged', subEntity(w, { paid_count: 2 }), renewal);          // duplicate
  await apply('subscription.charged', subEntity(w, { paid_count: 2 }), renewal, 'reconcile');
  await m.events.applyRazorpayEvent({ type: 'subscription.charged', eventAt: new Date(clock - 3_600_000), source: 'webhook', subEntity: subEntity(w), paymentEntity: first }); // late, older
  const sent = await rows(w.phone);
  assert.equal(sent.length, 2, 'first payment + one renewal');
  assert.match(textOf(sent[1]), /subscription has been renewed until/);
  await apply('subscription.charged', subEntity(w, { paid_count: 3 }), captured());
  assert.equal(await count(w.phone), 3, 'next year\'s charge is its own renewal');
});

test('no confirmation while access is held for review; held state unchanged by the notice', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace({ paymentAccessHold: true, subscriptionStatus: 'past_due', billingSubscriptionId: undefined });
  await apply('subscription.charged', subEntity(w, { paid_count: 2 }), captured());
  assert.equal(await count(w.phone), 0);
  assert.equal((await m.Business.findById(w.businessId).lean()).paymentAccessHold, true);
});

test('payment failure: the existing notice once; success afterwards clears the failure and its reminders', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  await apply('subscription.activated', subEntity(w), captured());
  await apply('subscription.pending', subEntity(w, { status: 'pending', paid_count: 1 }), null);
  await apply('subscription.pending', subEntity(w, { status: 'pending', paid_count: 1 }), null); // Razorpay retry
  const afterFailure = await rows(w.phone);
  assert.equal(afterFailure.length, 2, 'confirmation + one failure notice');
  assert.match(textOf(afterFailure[1]), /issue with your Growwmatics subscription payment/);
  let b: any = await m.Business.findById(w.businessId).lean();
  assert.equal(b.subscriptionStatus, 'past_due');
  assert.equal((await m.BillingRecoveryEpisode.findOne({ businessId: w.businessId }).lean()).status, 'open');

  await apply('subscription.charged', subEntity(w, { paid_count: 2 }), captured());
  b = await m.Business.findById(w.businessId).lean();
  assert.equal(b.subscriptionStatus, 'active');
  assert.equal(b.paymentFailedAt, undefined);
  assert.equal((await m.BillingRecoveryEpisode.findOne({ businessId: w.businessId }).lean()).status, 'resolved');
  const pass = await m.recovery.runRecoveryReminderPass({ businessId: w.businessId });
  assert.equal(pass.sent, 0, 'no failure reminder after recovery');
  const all = await rows(w.phone);
  assert.equal(all.length, 3);
  assert.match(textOf(all[2]), /renewed/);
});

test('a webhook alone never marks a subscription paid: an uncaptured charge sends nothing and grants nothing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  await apply('subscription.charged', subEntity(w, { paid_count: 0 }), { id: 'pay_x', status: 'failed', amount: 999_900, currency: 'INR' });
  assert.equal(await count(w.phone), 0);
  assert.notEqual((await m.Business.findById(w.businessId).lean()).subscriptionStatus, 'active');
});

async function trialWorkspace(daysLeft: number, over: Record<string, unknown> = {}) {
  return workspace({ subscriptionStatus: 'trial_active', trialStartedAt: new Date(Date.now() - 80 * DAY), trialEndsAt: new Date(Date.now() + daysLeft * DAY), billingSubscriptionId: undefined, ...over });
}

test('trial ending: one reminder inside the 3-day window; skipped after payment, after an extension, or outside the window', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const due = await trialWorkspace(2);
  const cancelled = await trialWorkspace(1, { trialCancelledAt: new Date() });
  const extended = await trialWorkspace(2);
  const paid = await trialWorkspace(2);
  const early = await trialWorkspace(10);
  await m.Business.updateOne({ _id: extended.businessId }, { $set: { trialEndsAt: new Date(Date.now() + 40 * DAY) } }); // extended before the run
  await m.Subscription.create({ userId: paid.userId, planType: 'Pro', billingStatus: 'Active' } as any);
  await m.notices.runTrialEndingReminders();
  await m.notices.runTrialEndingReminders(); // second daily run
  assert.equal(await count(due.phone), 1);
  assert.match(textOf((await rows(due.phone))[0]), /free trial ends on .+ subscription then starts automatically/);
  assert.equal(await count(cancelled.phone), 1);
  assert.match(textOf((await rows(cancelled.phone))[0]), /Subscribe before then to keep your access/);
  for (const w of [extended, paid, early]) assert.equal(await count(w.phone), 0);
  // Paying after the reminder went out → nothing more (re-checked each run).
  await m.Business.updateOne({ _id: due.businessId }, { $set: { subscriptionStatus: 'active' } });
  assert.equal((await m.notices.sendTrialEndingReminder(due.businessId)).status, 'skipped');
});

test('trial expiry (daily job, real Inngest engine): one "trial ended" message, no "cancelled" message; never when paid or extended', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const expired = await trialWorkspace(-1, { trialCancelledAt: new Date(Date.now() - 10 * DAY) });
  const paidElsewhere = await trialWorkspace(-1, { trialCancelledAt: new Date(Date.now() - 10 * DAY) });
  await m.Business.create({ name: 'Paid twin', category: 'Salon', address: 'Pune', userId: paidElsewhere.userId, organizationId: new m.mongoose.Types.ObjectId(), subscriptionStatus: 'active' } as any);
  await runDurably(m.fns.subscriptionExpiryWorker, { data: {} });
  await runDurably(m.fns.subscriptionExpiryWorker, { data: {} });
  const sent = await rows(expired.phone);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /free trial ended on .+ Subscribe to keep using Growwmatics/);
  assert.doesNotMatch(textOf(sent[0]), /has been cancelled/);
  assert.equal((await m.Business.findById(expired.businessId).lean()).subscriptionStatus, 'canceled');
  assert.equal(await count(paidElsewhere.phone), 0, 'owner has a paid workspace');
  const extended = await trialWorkspace(5);
  assert.deepEqual(await m.notices.sendTrialExpiredNotice(extended.businessId), { status: 'skipped', reason: 'trial-extended' });
});

test('app download link only from real configuration; missing app URL falls back to plain instructions', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal(m.notices.appDownloadLink(), null, 'NEXT_PUBLIC_ANDROID_APK_URL unset → no link to a "coming soon" page');
  process.env.NEXT_PUBLIC_ANDROID_APK_URL = 'https://cdn.example.test/growwmatics.apk';
  try {
    assert.equal(m.notices.appDownloadLink(), 'https://app.example.test/app');
    const w = await workspace();
    await apply('subscription.activated', subEntity(w), captured());
    assert.match(textOf((await rows(w.phone))[0]), /Get the app: https:\/\/app\.example\.test\/app/);
  } finally {
    delete process.env.NEXT_PUBLIC_ANDROID_APK_URL;
  }
  const base = process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  try {
    const text = m.notices.paymentConfirmedText({ kind: 'first', businessName: 'X', planName: 'P' });
    assert.match(text, /Open Billing in your Growwmatics dashboard/);
    assert.doesNotMatch(text, /https?:/, 'no invented link');
  } finally {
    process.env.NEXT_PUBLIC_APP_URL = base;
  }
});

test('missing template: nothing sent, the claim is given back, and payment/entitlement state is untouched', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  const saved = m.templates.WA_TEMPLATES.notification;
  (m.templates.WA_TEMPLATES as any).notification = '';
  try {
    await apply('subscription.activated', subEntity(w), captured());
  } finally {
    (m.templates.WA_TEMPLATES as any).notification = saved;
  }
  assert.equal(await count(w.phone), 0);
  const b: any = await m.Business.findById(w.businessId).lean();
  assert.equal(b.subscriptionStatus, 'active', 'activation stands');
  assert.ok(!(b.billingNoticeKeys || []).includes(`payment-first:${w.subId}`), 'released for a later event');
  await apply('subscription.charged', subEntity(w), captured()); // template configured again
  assert.equal(await count(w.phone), 1, 'sent once the template exists');
});

test('Segment 1 stays stopped: trial start and payment close the sales thread', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const paid = await workspace();
  await m.SalesConversation.create({ businessId: paid.businessId, leadPhone: paid.phone, phoneKey: paid.phone.slice(-10), status: 'active' } as any);
  await apply('subscription.activated', subEntity(paid), captured());
  assert.equal((await m.SalesConversation.findOne({ businessId: paid.businessId }).lean()).status, 'completed');

  const trial = await workspace();
  await m.SalesConversation.create({ businessId: trial.businessId, leadPhone: trial.phone, phoneKey: trial.phone.slice(-10), status: 'active' } as any);
  const trialEndsAt = new Date(Date.now() + 90 * DAY);
  await m.TrialClaim.create({
    phoneHash: `h_${trial.subId}`, status: 'reserved', userId: trial.userId, businessId: trial.businessId, holderBusinessId: trial.businessId, razorpaySubscriptionId: trial.subId,
    reservedAt: new Date(), reservedUntil: new Date(Date.now() + DAY),
    offer: { trialMonths: 3, trialEndsAt, razorpayPlanId: 'plan_yearly', amountPaise: 999_900, currency: 'INR', policyVersion: 1, decidedAt: new Date() },
  } as any);
  await apply('subscription.authenticated', subEntity(trial, { status: 'authenticated', paid_count: 0, start_at: Math.floor(trialEndsAt.getTime() / 1000), notes: { businessId: trial.businessId, userId: trial.userId, planType: 'Pro', trial: '1' } }), null);
  assert.equal((await m.Business.findById(trial.businessId).lean()).subscriptionStatus, 'trial_active');
  assert.equal((await m.SalesConversation.findOne({ businessId: trial.businessId }).lean()).status, 'completed');
  assert.equal(await count(trial.phone), 0, 'starting a trial sends no payment confirmation');
});
