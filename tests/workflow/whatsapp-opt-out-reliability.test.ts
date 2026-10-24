/**
 * Segment 3.1 — STOP / UNSUBSCRIBE / CANCEL reliability, through the REAL
 * webhook handlers (Twilio form posts and Meta JSON) against an in-memory
 * MongoDB:
 *  - tenant-number STOP matches the business's customer however the phone was
 *    stored, and never another country's number or another business;
 *  - the opt-out persists (MessagingSuppression): a deleted-and-re-added or
 *    owner-"un-opted" customer stays blocked;
 *  - an opt-out is applied even after the ordinary per-phone rate limit is spent;
 *  - a temporary failure leaves the message unprocessed (retryable status,
 *    retry job queued) and a redelivery / the retry job completes it;
 *  - duplicate deliveries have no duplicate effect.
 * WhatsApp delivery is mocked by the existing suppression switch; inngest.send
 * is captured, never delivered. No provider is contacted.
 *
 * Run: npx tsx --test tests/workflow/whatsapp-opt-out-reliability.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runDurably } from '../helpers/inngestReplay';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|LEAD_ENGINE|DO_SPACES)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
process.env.GROQ_API_KEY = 'test-unused';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:9'; // closed port → AI fails fast, never leaves the machine
process.env.WHATSAPP_PROVIDER = 'twilio';
process.env.TWILIO_TEMPLATE_NOTIFICATION = 'HXnotification_test';
process.env.TWILIO_TEMPLATE_REVIEW_REQUEST_UTILITY = 'HXreview_utility_test';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
process.env.NEXT_PUBLIC_BASE_URL = 'https://app.example.test';
// No auth token / app secret + non-production → the handlers' documented local signature skips.
process.env.PLATFORM_WHATSAPP_NUMBER = '+919000000000';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
const dispatched: any[] = [];

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_optout_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async (e: any) => { for (const x of [e].flat()) dispatched.push(x); return { ids: [] }; };
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    Customer: (await import('../../src/models/Customer')).default,
    ReviewRequest: (await import('../../src/models/ReviewRequest')).default,
    Suppression: (await import('../../src/models/MessagingSuppression')).default,
    Processed: (await import('../../src/models/ProcessedWebhookEvent')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
    Lead: (await import('../../src/models/Lead')).default,
    webhook: await import('../../src/app/api/whatsapp/webhook/route'),
    fns: await import('../../src/services/inngest/functions'),
    eligibility: await import('../../src/lib/reviewSendEligibility'),
  };
  // Unique indexes are the idempotency guarantees under test — build them up front.
  await Promise.all([m.Suppression.init(), m.Processed.init(), m.Customer.init()]);
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

let seq = 0;
const DAY = 86_400_000;

/** A business with its own WhatsApp number (tenant line). */
async function tenant() {
  const n = ++seq;
  const userId = new m.mongoose.Types.ObjectId();
  const number = `+9191111${String(n).padStart(5, '0')}`;
  const b = await m.Business.create({ name: `Salon ${n}`, category: 'Salon', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(), placeId: `ChIJoptout${String(n).padStart(6, '0')}`, subscriptionStatus: 'active', integrations: { whatsappNumber: number } } as any);
  await m.User.create({ _id: userId, fullName: `Owner ${n}`, email: `oo${n}@example.invalid`, phone: `+9196611${String(n).padStart(5, '0')}`, role: 'CLIENT', businessIds: [b._id] } as any);
  return { businessId: String(b._id), number };
}

async function customer(businessId: string, phone: string, request = true) {
  const c = await m.Customer.create({ tenantId: businessId, businessId, name: 'Asha', phone } as any);
  if (request) await m.ReviewRequest.create({ tenantId: businessId, businessId, customerId: c._id, message: 'x', status: 'Sent', sentAt: new Date(), token: `oo${Date.now()}${++seq}` } as any);
  return String(c._id);
}

const optedOut = async (id: string) => (await m.Customer.findById(id).lean())?.optedOut === true;
const suppressions = (businessId: string) => m.Suppression.countDocuments({ businessId });

let sidSeq = 0;
const newSid = () => `SMoo${Date.now()}${++sidSeq}`;
async function twilio(to: string, from: string, body: string, sid = newSid()) {
  const form = new URLSearchParams({ MessageSid: sid, From: `whatsapp:${from}`, To: `whatsapp:${to}`, Body: body, NumMedia: '0' });
  const res = await m.webhook.handleTwilioWebhook(new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  }));
  return { status: res.status, sid };
}

async function meta(to: string, messages: Array<{ from: string; id: string; body: string }>) {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      metadata: { display_phone_number: to.replace('+', ''), phone_number_id: 'pn-test' },
      contacts: messages.map((x) => ({ wa_id: x.from.replace('+', ''), profile: { name: 'Asha' } })),
      messages: messages.map((x) => ({ from: x.from.replace('+', ''), id: x.id, type: 'text', text: { body: x.body } })),
    } }] }],
  };
  const res = await m.webhook.POST(new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }));
  return res.status;
}

/** Make the next `times` suppression writes fail like a dropped database connection. */
function failSuppressionWrites(times = 1) {
  const real = m.Suppression.updateOne;
  let left = times;
  m.Suppression.updateOne = function (...args: any[]) {
    if (left-- > 0) return Promise.reject(Object.assign(new Error('connection reset (simulated)'), { code: 'ECONNRESET' }));
    return real.apply(this, args);
  };
  return () => { m.Suppression.updateOne = real; };
}

// ── 1. Tenant-number STOP: phone formats, other countries, other businesses ──

test('tenant STOP: matches legacy and international phone formats in this business only', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const cases: Array<[stored: string, inbound: string]> = [
    ['9876500001', '+919876500001'],          // CSV: bare 10 digits
    ['098765 00002', '+919876500002'],        // leading 0 + space
    ['+91-98765-00003', '+919876500003'],     // dashes
    ['0091 98765 00004', '+919876500004'],    // 00 international prefix
    ['919876500005', '+919876500005'],        // country code, no plus
    ['+44 7700 900123', '+447700900123'],     // UK number with spaces
    ['+1 (415) 555-0100', '+14155550100'],    // US number, brackets
  ];
  for (const [stored, inbound] of cases) {
    const a = await tenant();
    const other = await tenant();
    const target = await customer(a.businessId, stored);
    const sameNumberOtherBusiness = await customer(other.businessId, stored);
    // Same last 10 digits, different country code, same business.
    const lookalike = await customer(a.businessId, `+7${inbound.replace(/\D/g, '').slice(-10)}`);

    const { status } = await twilio(a.number, inbound, 'STOP');
    assert.equal(status, 200, stored);
    assert.equal(await optedOut(target), true, `stored as "${stored}"`);
    assert.equal((await m.ReviewRequest.findOne({ customerId: target }).lean()).automationStatus, 'Stopped');
    assert.equal(await optedOut(lookalike), false, `+7 number sharing the last 10 digits of ${inbound}`);
    assert.equal(await optedOut(sameNumberOtherBusiness), false, 'another business (tenant isolation)');
    assert.equal(await suppressions(a.businessId), 1);
    assert.equal(await suppressions(other.businessId), 0);
  }
});

test('tenant STOP from a number with no Customer record still suppresses it for that business', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await tenant();
  await twilio(a.number, '+919876511111', 'unsubscribe');
  const row: any = await m.Suppression.findOne({ businessId: a.businessId }).lean();
  assert.equal(row.phoneE164, '+919876511111');
  assert.equal(row.source, 'tenant_number');
  assert.equal(row.keyword, 'UNSUBSCRIBE');
});

// ── 2. Persistent suppression survives delete + re-add ─────────────────────

test('a deleted and re-added customer stays opted out; the owner un-ticking it does not re-enable sends; other businesses are unaffected', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await tenant();
  const b = await tenant();
  const first = await customer(a.businessId, '9876522222');
  await twilio(a.number, '+919876522222', 'CANCEL');
  assert.equal(await optedOut(first), true);

  await m.Customer.deleteOne({ _id: first }); // owner deletes them…
  await m.ReviewRequest.deleteMany({ customerId: first });
  const readded = await customer(a.businessId, '+91 98765 22222', false); // …and adds them again
  assert.equal(await optedOut(readded), false, 'a fresh record starts clean');
  const c: any = await m.Customer.findById(readded).lean();
  const gate = await m.eligibility.evaluateReviewSendEligibility({ source: 'manual', businessId: a.businessId, customer: c });
  assert.deepEqual([gate.allowed, gate.code], [false, 'OPTED_OUT']);
  assert.equal(await optedOut(readded), true, 'the record is brought back in line');

  // The owner un-ticks "opted out": still blocked.
  await m.Customer.updateOne({ _id: readded }, { $set: { optedOut: false } });
  const again = await m.eligibility.evaluateReviewSendEligibility({ source: 'manual', businessId: a.businessId, customer: { ...c, optedOut: false } });
  assert.equal(again.code, 'OPTED_OUT');

  // The worker refuses it too, even when started directly (no send at all).
  await m.Customer.updateOne({ _id: readded }, { $set: { optedOut: false } });
  const out: any = await runDurably(m.fns.processReviewCampaign, { data: { customerId: readded, businessId: a.businessId, tenantId: a.businessId } });
  assert.equal(out.result.skipped, true);
  assert.equal(await m.MessageQueue.countDocuments({ 'payload.phone': { $in: ['+919876522222', '+91 98765 22222'] } }), 0);

  // The same number at another business that never got a STOP is still messageable.
  const elsewhere = await customer(b.businessId, '9876522222', false);
  const ok = await m.eligibility.evaluateReviewSendEligibility({ source: 'manual', businessId: b.businessId, customer: await m.Customer.findById(elsewhere).lean() });
  assert.equal(ok.code, 'OK');
});

test('platform-number STOP from a review recipient persists per business that asked them', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const asked = await tenant();
  const never = await tenant();
  const first = await customer(asked.businessId, '9876533333'); // sent a request on the shared line
  await twilio('+919000000000', '+919876533333', 'STOP');
  assert.equal(await optedOut(first), true);
  assert.equal(await suppressions(asked.businessId), 1);
  assert.equal(await suppressions(never.businessId), 0, 'a business that never asked this number is not suppressed');
  await m.Customer.deleteOne({ _id: first });
  const readded = await customer(asked.businessId, '9876533333', false);
  const gate = await m.eligibility.evaluateReviewSendEligibility({ source: 'manual', businessId: asked.businessId, customer: await m.Customer.findById(readded).lean() });
  assert.equal(gate.code, 'OPTED_OUT');
});

// ── 3. Rate limit ──────────────────────────────────────────────────────────

test('STOP is applied after the ordinary per-phone rate limit is spent; ordinary messages stay capped', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await tenant();
  const phone = '+919876544444';
  const id = await customer(a.businessId, phone);
  dispatched.length = 0;
  for (let i = 0; i < 12; i++) await twilio(a.number, phone, `message ${i}`);
  const routed = () => dispatched.filter((e) => e.name === 'whatsapp/incoming').length;
  assert.equal(routed(), 10, 'ordinary messages still capped at 10 per minute');
  await twilio(a.number, phone, 'STOP');
  assert.equal(await optedOut(id), true, 'the STOP was not dropped');
  assert.equal(routed(), 11, 'the STOP itself is routed (thread AI switched off)');
  await twilio(a.number, phone, 'message after stop');
  assert.equal(routed(), 11, 'the cap still applies to ordinary messages');
});

// ── 4. Temporary failure, then retry ───────────────────────────────────────

test('Twilio: a temporary failure leaves the STOP unprocessed (500 + retry job); a redelivery completes it', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await tenant();
  const phone = '+919876555555';
  const id = await customer(a.businessId, phone);
  dispatched.length = 0;
  const restore = failSuppressionWrites(1);
  let first: { status: number; sid: string };
  try {
    first = await twilio(a.number, phone, 'STOP');
  } finally {
    restore();
  }
  assert.equal(first.status, 500, 'retryable status');
  assert.equal(await m.Processed.countDocuments({ eventId: first.sid }), 0, 'not marked processed');
  assert.equal(await optedOut(id), false);
  const retry = dispatched.find((e) => e.name === 'whatsapp/opt-out.retry');
  assert.equal(retry?.id, `whatsapp-opt-out-twilio-${first.sid}`, 'retry job queued, deduplicated per message');
  assert.equal(dispatched.filter((e) => e.name === 'whatsapp/incoming').length, 0, 'nothing routed yet');

  // Provider redelivery of the same message.
  const second = await twilio(a.number, phone, 'STOP', first.sid);
  assert.equal(second.status, 200);
  assert.equal(await optedOut(id), true);
  assert.equal(await m.Processed.countDocuments({ eventId: first.sid }), 1);
  assert.equal(dispatched.filter((e) => e.name === 'whatsapp/incoming').length, 1, 'routed once');

  // The queued retry job also runs: idempotent, no second effect.
  const out: any = await runDurably(m.fns.inboundOptOutRetry, { data: retry.data });
  assert.equal(out.result.success, true);
  assert.equal(await suppressions(a.businessId), 1);
});

test('the retry job alone completes an opt-out when the provider never redelivers', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await tenant();
  const phone = '+919876566666';
  const id = await customer(a.businessId, phone);
  dispatched.length = 0;
  const restore = failSuppressionWrites(1);
  try {
    assert.equal((await twilio(a.number, phone, 'STOP')).status, 500);
  } finally {
    restore();
  }
  const retry = dispatched.find((e) => e.name === 'whatsapp/opt-out.retry');
  await runDurably(m.fns.inboundOptOutRetry, { data: retry.data });
  assert.equal(await optedOut(id), true);
  assert.equal(await suppressions(a.businessId), 1);
});

test('Meta: a failed STOP makes the delivery retryable; the other message in it is not processed twice', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await tenant();
  const stopper = '+919876577777';
  const id = await customer(a.businessId, stopper);
  const msgs = [{ from: '+919876577778', id: `wamid.hi${++seq}`, body: 'hello there' }, { from: stopper, id: `wamid.stop${++seq}`, body: 'Stop' }];
  dispatched.length = 0;
  const restore = failSuppressionWrites(1);
  let status: number;
  try {
    status = await meta(a.number, msgs);
  } finally {
    restore();
  }
  assert.equal(status, 500);
  assert.equal(await optedOut(id), false);
  assert.equal(await m.Processed.countDocuments({ eventId: msgs[1].id }), 0);
  assert.equal(await meta(a.number, msgs), 200, 'redelivery succeeds');
  assert.equal(await optedOut(id), true);
  const incoming = dispatched.filter((e) => e.name === 'whatsapp/incoming');
  assert.equal(incoming.filter((e) => e.data.body === 'hello there').length, 1, 'the ordinary message was handled once');
  assert.equal(incoming.filter((e) => /stop/i.test(e.data.body)).length, 1);
});

// ── 5. Duplicate deliveries ────────────────────────────────────────────────

test('duplicate STOP deliveries (Twilio and Meta): one suppression, one routing, no message sent', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await tenant();
  const phone = '+919876588888';
  const id = await customer(a.businessId, phone);
  dispatched.length = 0;
  const sid = newSid();
  const results = await Promise.all([twilio(a.number, phone, 'STOP', sid), twilio(a.number, phone, 'STOP', sid)]);
  await twilio(a.number, phone, 'STOP', sid);
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(await optedOut(id), true);
  assert.equal(await suppressions(a.businessId), 1);
  assert.equal(await m.Processed.countDocuments({ eventId: sid }), 1);
  assert.equal(dispatched.filter((e) => e.name === 'whatsapp/incoming').length, 1, 'routed once');

  const metaId = `wamid.dup${++seq}`;
  for (let i = 0; i < 3; i++) assert.equal(await meta(a.number, [{ from: phone, id: metaId, body: 'STOP' }]), 200);
  assert.equal(dispatched.filter((e) => e.name === 'whatsapp/incoming').length, 2, 'the Meta message is routed once too');
  assert.equal(await suppressions(a.businessId), 1);
  assert.equal(await m.MessageQueue.countDocuments({ 'payload.phone': phone }), 0, 'an opt-out never sends anything');
});

// ── 6. Normal routing unchanged ────────────────────────────────────────────

test('ordinary tenant messages still route to the business agent and opt nobody out', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await tenant();
  const id = await customer(a.businessId, '+919876599999');
  dispatched.length = 0;
  for (const body of ['Do you open on Sunday?', 'please stop by tomorrow', 'cancel my 5pm booking']) await twilio(a.number, '+919876599999', body);
  assert.equal(dispatched.filter((e) => e.name === 'whatsapp/incoming' && e.data.businessId === a.businessId).length, 3);
  assert.equal(await optedOut(id), false, 'only the exact keywords opt out');
  assert.equal(await suppressions(a.businessId), 0);
});
