/**
 * Outbound-send suppression — proves that with QA_SUPPRESS_OUTBOUND_SENDS (or
 * the legacy WhatsApp flag) NO real outbound request is made on any channel a
 * migration test can reach: Meta Cloud API, Twilio, Expo push, email.
 * It also proves the flag-OFF path is unchanged (the request IS attempted), so
 * production behaviour is not altered.
 *
 * The network is observed by replacing global fetch and http(s).request with
 * recorders that reject — no request can leave the process. Uses a disposable
 * local MongoDB database. Run via `npm run test:jobs:smoke`.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';

const DB_NAME = `suppress_smoke_${Date.now().toString(36)}`;
let mongoose: any;
let db: any;
const calls: string[] = [];
const realFetch = globalThis.fetch;
const realHttps = https.request;
const realHttp = http.request;
let fetchReply: () => any = () => ({ ok: true, status: 200, json: async () => ({}) });

const SUPPRESS_KEYS = ['QA_SUPPRESS_OUTBOUND_SENDS', 'QA_SUPPRESS_WHATSAPP_SENDS'];

before(async () => {
  assert.ok(!/prod/i.test(DB_NAME));
  const { resolveLoopbackTestUri } = await import('../../scripts/lib/loopbackTestDb.mjs');
  process.env.MONGODB_URI = resolveLoopbackTestUri({ dbName: DB_NAME });
  (process.env as any).NODE_ENV = 'test';
  // Fake provider config so the code reaches the point of "would send".
  process.env.META_WHATSAPP_ACCESS_TOKEN = 'fake-meta-token';
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = '123456';
  process.env.WHATSAPP_PROVIDER = 'meta';
  process.env.RESEND_API_KEY = 're_fake_key_for_test';
  process.env.RESEND_FROM_EMAIL = 'noreply@example.test';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_fake_key';
  process.env.RAZORPAY_KEY_SECRET = 'fake_secret_for_test';
  process.env.TWILIO_ACCOUNT_SID = 'ACfake';
  process.env.TWILIO_AUTH_TOKEN = 'fake';
  process.env.TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155550000';

  globalThis.fetch = (async (input: any) => {
    calls.push(`fetch ${String(input?.url ?? input)}`);
    return fetchReply();
  }) as any;
  (https as any).request = (...a: any[]) => {
    calls.push(`https ${String(a[0]?.href ?? a[0]?.hostname ?? a[0])}`);
    throw new Error('network disabled in test');
  };
  (http as any).request = (...a: any[]) => {
    calls.push(`http ${String(a[0]?.href ?? a[0]?.hostname ?? a[0])}`);
    throw new Error('network disabled in test');
  };

  mongoose = (await import('mongoose')).default;
  const dbConnect = (await import('../../src/lib/mongodb')).default;
  await dbConnect();
  db = mongoose.connection.db;
  assert.equal(db.databaseName, DB_NAME);
});

after(async () => {
  globalThis.fetch = realFetch;
  (https as any).request = realHttps;
  (http as any).request = realHttp;
  if (db?.databaseName === DB_NAME) await db.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});

beforeEach(() => {
  calls.length = 0;
  for (const k of [...SUPPRESS_KEYS, 'APP_ENV']) delete process.env[k];
  fetchReply = () => ({ ok: true, status: 200, json: async () => ({}) });
});

const outbound = () => calls.filter((c) => !/mongodb/i.test(c));

// ------------------------------------------------------------ WhatsApp --

test('Meta Cloud API: suppressed ⇒ success with a synthetic sid and zero requests (text, image, template)', async () => {
  process.env.QA_SUPPRESS_OUTBOUND_SENDS = 'true';
  const { sendMetaText, sendMetaImage, sendMetaTemplate } = await import('../../src/services/whatsapp/meta');
  const a = await sendMetaText('+919999999999', 'hello');
  const b = await sendMetaImage('+919999999999', 'https://example.test/x.png', 'cap');
  const c = await sendMetaTemplate('+919999999999', 'tmpl', 'en', ['x']);
  for (const r of [a, b, c]) {
    assert.equal(r.success, true);
    assert.match(String(r.sid), /^qa_meta_/);
  }
  assert.deepEqual(outbound(), []);
});

test('Meta Cloud API: legacy QA_SUPPRESS_WHATSAPP_SENDS also suppresses', async () => {
  process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
  const { sendMetaText } = await import('../../src/services/whatsapp/meta');
  assert.match(String((await sendMetaText('+919999999999', 'hi')).sid), /^qa_meta_/);
  assert.deepEqual(outbound(), []);
});

test('Meta Cloud API: flag OFF ⇒ behaviour unchanged (the real request IS attempted)', async () => {
  fetchReply = () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.REAL' }] }) });
  const { sendMetaText } = await import('../../src/services/whatsapp/meta');
  const r = await sendMetaText('+919999999999', 'hi');
  assert.equal(r.success, true);
  assert.equal(r.sid, 'wamid.REAL');
  assert.equal(outbound().length, 1);
  assert.match(outbound()[0], /graph\.facebook\.com/);
});

test('router (whatsapp/send.ts → Meta): suppressed ⇒ logged as SENT, zero requests', async () => {
  process.env.QA_SUPPRESS_OUTBOUND_SENDS = 'true';
  const { sendOutboundMessage } = await import('../../src/services/whatsapp/send');
  const r = await sendOutboundMessage('+919999999999', 'router test');
  assert.equal(r.success, true);
  assert.match(String(r.sid), /^qa_meta_/);
  assert.deepEqual(outbound(), []);
});

test('Twilio client: suppressed ⇒ synthetic sid, MessageQueue row marked qaSuppressed, zero requests', async () => {
  process.env.QA_SUPPRESS_OUTBOUND_SENDS = 'true';
  const tw = await import('../../src/services/twilio/client');
  const r1 = await tw.sendOutboundMessage('+919999999999', 'twilio text');
  const r2 = await tw.sendTemplateMessage('+919999999999', 'HX0000000000000000000000000000000a', { 1: 'x' });
  for (const r of [r1, r2]) {
    assert.equal(r.success, true);
    assert.match(String(r.sid), /^qa_/);
  }
  assert.deepEqual(outbound(), []);
  const n = await db.collection('messagequeues').countDocuments({ 'payload.qaSuppressed': true });
  assert.ok(n >= 2);
});

// ---------------------------------------------------------------- push --

test('push: suppressed ⇒ Expo is never called; flag OFF ⇒ it is', async () => {
  const User = (await import('../../src/models/User')).default;
  const { sendPushToUser } = await import('../../src/services/push');
  const _id = new mongoose.mongo.ObjectId();
  await User.collection.insertOne({
    _id, email: 'push@example.test', phone: '+919111111111', name: 'Push',
    pushTokens: ['ExponentPushToken[fake-token]'],
  } as any);

  process.env.QA_SUPPRESS_OUTBOUND_SENDS = 'true';
  await sendPushToUser(String(_id), { title: 't', body: 'b' });
  assert.deepEqual(outbound(), []);

  delete process.env.QA_SUPPRESS_OUTBOUND_SENDS;
  fetchReply = () => ({ ok: true, status: 200, json: async () => ({ data: [{ status: 'ok' }] }) });
  await sendPushToUser(String(_id), { title: 't', body: 'b' });
  assert.equal(outbound().length, 1);
  assert.match(outbound()[0], /exp\.host|expo/i);
});

test('push: the legacy WhatsApp flag must NOT suppress push (flags do not widen)', async () => {
  const User = (await import('../../src/models/User')).default;
  const { sendPushToUser } = await import('../../src/services/push');
  const _id = new mongoose.mongo.ObjectId();
  await User.collection.insertOne({
    _id, email: 'push2@example.test', phone: '+919111111112', name: 'Push2',
    pushTokens: ['ExponentPushToken[fake-token-2]'],
  } as any);
  process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
  fetchReply = () => ({ ok: true, status: 200, json: async () => ({ data: [{ status: 'ok' }] }) });
  await sendPushToUser(String(_id), { title: 't', body: 'b' });
  assert.equal(outbound().length, 1);
});

// --------------------------------------------------------------- email --

test('email: suppressed ⇒ qa_suppressed result and zero requests (review, OTP, transactional)', async () => {
  process.env.QA_SUPPRESS_OUTBOUND_SENDS = 'true';
  const email = await import('../../src/services/email');
  const a: any = await email.sendEmail('x@example.test', 'N', 'svc', 'https://example.test/r', 'Biz');
  const b: any = await email.sendEmailOtp('x@example.test', '123456', 'verify');
  const c: any = await email.sendTransactionalEmail('x@example.test', 'subject', '<p>hi</p>');
  for (const r of [a, b, c]) {
    assert.equal(r.success, true);
    assert.equal(r.messageId, 'qa_suppressed');
  }
  assert.deepEqual(outbound(), []);
});

test('email: flag OFF ⇒ the suppression path is not taken', async () => {
  const email = await import('../../src/services/email');
  const c: any = await email.sendTransactionalEmail('x@example.test', 'subject', '<p>hi</p>');
  assert.notEqual(c?.messageId, 'qa_suppressed');
});


// ============================================ hardening: production + external ops ==

test('M3: in a production-like environment the flag is IGNORED and the real request is attempted', async () => {
  const prevEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = 'production';
  delete process.env.APP_ENV;
  process.env.QA_SUPPRESS_OUTBOUND_SENDS = 'true';
  try {
    fetchReply = () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.PROD' }] }) });
    const { sendMetaText } = await import('../../src/services/whatsapp/meta');
    const r = await sendMetaText('+919999999999', 'hello');
    assert.equal(r.sid, 'wamid.PROD', 'a stray flag must not swallow a production send');
    assert.equal(outbound().length, 1);
    assert.match(outbound()[0], /graph\.facebook\.com/);
  } finally {
    (process.env as any).NODE_ENV = prevEnv;
  }
});

test('M3: with an explicit staging marker the flag is honoured in a production build', async () => {
  const prevEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = 'production';
  process.env.APP_ENV = 'staging';
  process.env.QA_SUPPRESS_OUTBOUND_SENDS = 'true';
  try {
    const { sendMetaText } = await import('../../src/services/whatsapp/meta');
    const r = await sendMetaText('+919999999999', 'hello');
    assert.match(String(r.sid), /^qa_meta_/);
    assert.deepEqual(outbound(), []);
  } finally {
    (process.env as any).NODE_ENV = prevEnv;
    delete process.env.APP_ENV;
  }
});

test('M3: Google Calendar invites are blocked (fail closed) when suppression is on, attempted when off', async () => {
  const { insertMeetEvent } = await import('../../src/services/calendar/salespersonCalendar');
  const { SuppressedExternalOperation } = await import('../../src/lib/outboundSuppression');
  const input = {
    accessToken: 'fake', calendarId: 'primary', title: 't', description: 'd',
    start: new Date(), end: new Date(Date.now() + 1800_000), attendeeEmail: 'customer@example.test', requestId: 'r1',
  };

  process.env.QA_SUPPRESS_OUTBOUND_SENDS = 'true';
  await assert.rejects(() => insertMeetEvent(input), (e: any) => e instanceof SuppressedExternalOperation);
  assert.deepEqual(outbound(), [], 'no calendar request, so no invite email to the attendee');

  delete process.env.QA_SUPPRESS_OUTBOUND_SENDS;
  fetchReply = () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => insertMeetEvent(input));
  assert.equal(outbound().length, 1, 'flag off: the real request is attempted (behaviour unchanged)');
});

test('M3: Razorpay cancel is blocked AND is not swallowed as "already cancelled"', async () => {
  const Subscription = (await import('../../src/models/Subscription')).default;
  const { cancelRazorpayForDeletedAccount } = await import('../../src/lib/billing/deletionCancel');
  const { SuppressedExternalOperation } = await import('../../src/lib/outboundSuppression');
  const subId = `sub_${Math.random().toString(36).slice(2, 10)}`;
  await Subscription.collection.insertOne({
    _id: new mongoose.mongo.ObjectId(), userId: new mongoose.mongo.ObjectId(),
    razorpaySubscriptionId: subId, billingStatus: 'Active', status: 'active', planType: 'Pro',
  } as any);

  process.env.QA_SUPPRESS_OUTBOUND_SENDS = 'true';
  await assert.rejects(() => cancelRazorpayForDeletedAccount(subId), (e: any) => e instanceof SuppressedExternalOperation);
  const after: any = await Subscription.collection.findOne({ razorpaySubscriptionId: subId });
  assert.equal(after.billingStatus, 'Active', 'the local record must not be marked cancelled by a blocked call');
  assert.deepEqual(outbound(), []);
});

test('M3: suppression summary exposes counts only (no payloads) and violations by name', async () => {
  const { suppressionSummary, suppressOutbound } = await import('../../src/lib/outboundSuppression');
  process.env.QA_SUPPRESS_OUTBOUND_SENDS = 'true';
  suppressOutbound('email', 'otp');
  const s = suppressionSummary();
  assert.equal(s.active, true);
  assert.ok((s.suppressed.email ?? 0) >= 1);
  const text = JSON.stringify(s);
  assert.ok(!/@|\+91|fake-meta-token|re_fake/.test(text), 'no recipients or secrets in health output');
});
