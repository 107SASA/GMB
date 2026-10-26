/**
 * POST /api/webhook/razorpay — the REAL route: HMAC-SHA256 over the exact raw
 * body, rejection before any state change, event-id idempotency (sequential
 * and concurrent duplicates), and a declined payment carrying another
 * workspace's id in its notes. In-memory MongoDB; Razorpay API keys are not
 * configured, so nothing is contacted. The webhook secret is a test value.
 *
 * Run: npx tsx --test tests/workflow/billing-webhook-route.test.ts
 */
import { startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST)_/.test(k)) delete process.env[k];
const SECRET = 'whsec_route_test_not_real';
process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

let skipReason: string | null = null;
let m: any = {};

before(async () => {
  skipReason = await startMemoryDb('webhook_route');
  if (skipReason) return;
  m = {
    mongoose: (await import('mongoose')).default,
    route: await import('../../src/app/api/webhook/razorpay/route'),
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    BillingEvent: (await import('../../src/models/BillingEvent')).default,
    ProcessedWebhookEvent: (await import('../../src/models/ProcessedWebhookEvent')).default,
    SecurityEvent: (await import('../../src/models/SecurityEvent')).default,
  };
});
after(async () => {
  if (!skipReason) await stopMemoryDb();
});

const sign = (raw: string, secret = SECRET) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
const deliver = (raw: string, headers: Record<string, string>) =>
  m.route.POST(new Request('https://app.example.test/api/webhook/razorpay', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.20', ...headers }, body: raw }));

let seq = 0;
async function workspace() {
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: `Hook ${++seq}`, category: 'Bakery', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId() } as any);
  await m.User.create({ _id: userId, fullName: `Hook Owner ${seq}`, email: `hook${seq}@example.invalid`, phone: `+9198767${String(seq).padStart(5, '0')}`, role: 'CLIENT', businessIds: [b._id] } as any);
  return { businessId: String(b._id), userId: String(userId) };
}

const chargedEvent = (subId: string, businessId: string, userId: string, amount = 199_900) => ({
  event: 'subscription.charged',
  created_at: Math.floor(Date.now() / 1000),
  payload: {
    subscription: { entity: { id: subId, status: 'active', plan_id: 'plan_m', paid_count: 1, current_end: Math.floor(Date.now() / 1000) + 30 * 86400, notes: { businessId, userId, planType: 'Pro', billingCycle: 'monthly', trial: '0' } } },
    payment: { entity: { id: `pay_${subId}`, amount, currency: 'INR', status: 'captured' } },
  },
});

const status = async (businessId: string) => (await m.Business.findById(businessId).select('subscriptionStatus').lean())?.subscriptionStatus ?? 'trialing';

test('a correctly signed charge activates the workspace', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace();
  const raw = JSON.stringify(chargedEvent('sub_ok', businessId, userId));
  const res = await deliver(raw, { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_ok' });
  assert.equal(res.status, 200);
  assert.equal(await status(businessId), 'active');
});

test('missing, wrong-secret, and tampered-body signatures are refused before any change (and logged)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace();
  const raw = JSON.stringify(chargedEvent('sub_forged', businessId, userId));
  const tampered = raw.replace('"amount":199900', '"amount":100');

  const cases: Array<{ headers: Record<string, string>; body?: string }> = [
    { headers: { 'x-razorpay-event-id': 'evt_f1' } },
    { headers: { 'x-razorpay-signature': sign(raw, 'some-other-secret'), 'x-razorpay-event-id': 'evt_f2' } },
    { headers: { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_f3' }, body: tampered },
    { headers: { 'x-razorpay-signature': 'not-hex', 'x-razorpay-event-id': 'evt_f4' } },
  ];
  for (const c of cases) {
    const res = await deliver(c.body ?? raw, c.headers);
    assert.equal(res.status, 403);
  }
  assert.equal(await status(businessId), 'trialing', 'nothing was activated');
  assert.equal(await m.ProcessedWebhookEvent.countDocuments({ eventId: { $in: ['evt_f1', 'evt_f2', 'evt_f3', 'evt_f4'] } }), 0, 'no dedup claim for a refused delivery');
  assert.equal(await m.BillingEvent.countDocuments({ razorpaySubscriptionId: 'sub_forged' }), 0);
  const logged: any[] = await m.SecurityEvent.find({ type: 'webhook.signature_invalid' }).lean();
  assert.ok(logged.length >= 4);
  assert.ok(!JSON.stringify(logged).includes(SECRET), 'the secret is never logged');
});

test('a replayed event id is applied once (sequential redelivery)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace();
  const raw = JSON.stringify(chargedEvent('sub_replay', businessId, userId));
  const headers = { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_replay' };
  assert.equal((await deliver(raw, headers)).status, 200);
  const second = await deliver(raw, headers);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).skipped, 'duplicate event');
  assert.equal(await m.BillingEvent.countDocuments({ razorpaySubscriptionId: 'sub_replay' }), 1);
});

test('the same event delivered concurrently is applied exactly once', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace();
  const raw = JSON.stringify(chargedEvent('sub_concurrent', businessId, userId));
  const headers = { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_concurrent' };
  const results = await Promise.all(Array.from({ length: 8 }, () => deliver(raw, headers)));
  assert.ok(results.every((r: Response) => r.status === 200));
  assert.equal(await m.BillingEvent.countDocuments({ razorpaySubscriptionId: 'sub_concurrent' }), 1);
  assert.equal(await status(businessId), 'active');
});

test('a declined payment naming another workspace in its notes changes no access', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const victim = await workspace();
  await m.Business.updateOne({ _id: victim.businessId }, { $set: { subscriptionStatus: 'active', billingSubscriptionId: 'sub_victim' } });
  const raw = JSON.stringify({
    event: 'payment.failed',
    created_at: Math.floor(Date.now() / 1000),
    payload: { payment: { entity: { id: 'pay_x', amount: 100, currency: 'INR', status: 'failed', notes: { businessId: victim.businessId, userId: victim.userId } } } },
  });
  const res = await deliver(raw, { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_declined' });
  assert.equal(res.status, 200);
  assert.equal(await status(victim.businessId), 'active');
});

test('an unhandled event type is acknowledged without any change', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const raw = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1' } } } });
  const res = await deliver(raw, { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_refund' });
  assert.equal(res.status, 200);
  assert.equal(await m.BillingEvent.countDocuments({ eventType: 'refund.processed' }), 0);
});
