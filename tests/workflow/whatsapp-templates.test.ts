/**
 * WhatsApp template contract + failure visibility, through the REAL send
 * code (services/twilio/client.ts, services/whatsapp/send.ts), the REAL
 * status-callback route and the REAL feature senders, against an in-memory
 * MongoDB. The `twilio` package is replaced by a recording stub — nothing
 * reaches Twilio, nothing is delivered to anyone.
 *
 * The expected variables per template come from the live Twilio Content API
 * audit (2026-10-25): each approved template's placeholders and button URLs.
 *
 * Run: npx tsx --test tests/workflow/whatsapp-templates.test.ts
 */
import { startMemoryDb, stopMemoryDb, jsonReq } from '../helpers/adminRouteHarness';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

// ── Twilio stub — installed before any app module loads ───────────────────
type Call = { to: string; body?: string; contentSid?: string; variables?: Record<string, string> };
const calls: Call[] = [];
/** Errors the next create() calls throw, in order. */
let errorQueue: Array<{ code: number; message: string }> = [];
let nextError: { code: number; message: string } | null = null;
const loader = Module as any;
const realTwilio = loader._load('twilio', module, false);
const twilioStub: any = () => ({
  messages: {
    create: async (p: any) => {
      calls.push({ to: p.to, body: p.body, contentSid: p.contentSid, variables: p.contentVariables ? JSON.parse(p.contentVariables) : undefined });
      const err = nextError ?? errorQueue.shift() ?? null;
      if (err) {
        const e: any = new Error(err.message);
        e.code = err.code;
        nextError = null;
        throw e;
      }
      return { sid: `SMstub${calls.length}` };
    },
  },
});
twilioStub.validateRequest = realTwilio.validateRequest;
twilioStub.default = twilioStub;
const prevLoad = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
  if (request === 'twilio') return twilioStub;
  return prevLoad.call(this, request, ...rest);
};

// ── Fake configuration; template SIDs are the live approved ones (identifiers, not secrets) ──
for (const k of Object.keys(process.env)) if (/^(TWILIO|META_WHATSAPP|META_UTILITY|GROQ|INNGEST|LEAD_ENGINE)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
const LIVE = {
  TWILIO_TEMPLATE_SALES_INTRO: 'HX00488ae562a06304e9fc5a12e256a05e',
  TWILIO_TEMPLATE_REPORT_READY: 'HX199de4a54ea1e3c5bf6f1dd9ff5a4fab',
  TWILIO_TEMPLATE_REVIEW_REQUEST: 'HXdbaacb1427dfebb907072e9156c09acd',
  TWILIO_TEMPLATE_REVIEW_REQUEST_UTILITY: 'HX5ac75bff43238d0c253a1dd15cca746c',
  TWILIO_TEMPLATE_NOTIFICATION: 'HX955e0797b63eed9f9437cb29ef85bc66',
  TWILIO_TEMPLATE_INVOICE_READY: 'HX9f2c0fe311fb5d374a491834e1ce29dc',
  TWILIO_TEMPLATE_WELCOME_CUSTOMER: 'HX0b4cb882dd9f2e5eac2ee0adffb010f5',
  TWILIO_TEMPLATE_PAYMENT_RECEIVED: 'HXc4db2492019d861e69f7ff84b42e7b97',
  TWILIO_TEMPLATE_LOGIN_OTP: 'HX47e1843b509b1f43e0a832aa51fe00be',
};
Object.assign(process.env, LIVE, {
  TWILIO_ACCOUNT_SID: 'ACtest_not_real',
  TWILIO_AUTH_TOKEN: 'test_not_real_token',
  TWILIO_WHATSAPP_NUMBER: '+10000000000',
  WHATSAPP_PROVIDER: 'twilio',
  QA_SUPPRESS_WHATSAPP_SENDS: 'false', // the real send path runs — against the stub
  NEXT_PUBLIC_APP_URL: 'https://app.example.test',
  GROQ_API_KEY: 'test-unused',
  GROQ_BASE_URL: 'http://127.0.0.1:9',
});

/** Placeholders of each live approved template (Twilio Content API, 2026-10-25). */
const LIVE_PLACEHOLDERS: Record<string, string[]> = {
  [LIVE.TWILIO_TEMPLATE_SALES_INTRO]: ['1', '2'],
  [LIVE.TWILIO_TEMPLATE_REPORT_READY]: ['1', '2', '3'],
  [LIVE.TWILIO_TEMPLATE_REVIEW_REQUEST]: ['1', '2', '3'],
  [LIVE.TWILIO_TEMPLATE_REVIEW_REQUEST_UTILITY]: ['1', '2', '3'],
  [LIVE.TWILIO_TEMPLATE_NOTIFICATION]: ['1', '2'],
  [LIVE.TWILIO_TEMPLATE_PAYMENT_RECEIVED]: ['1'],
  [LIVE.TWILIO_TEMPLATE_LOGIN_OTP]: ['1'],
};

let skipReason: string | null = null;
let m: any = {};
const logs: string[] = [];
const origError = console.error;
const origWarn = console.warn;

before(async () => {
  console.error = (...a: any[]) => { logs.push(a.map(String).join(' ')); };
  console.warn = (...a: any[]) => { logs.push(a.map(String).join(' ')); };
  skipReason = await startMemoryDb('wa_templates');
  if (skipReason) return;
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async () => ({ ids: [] });
  m = {
    mongoose: (await import('mongoose')).default,
    diag: await import('../../src/lib/whatsappDiagnostics'),
    twilio: await import('../../src/services/twilio/client'),
    send: await import('../../src/services/whatsapp/send'),
    templates: await import('../../src/lib/whatsappTemplates'),
    review: await import('../../src/lib/reviewRequestFlow'),
    status: await import('../../src/app/api/webhook/twilio/status/route'),
    webhook: await import('../../src/app/api/whatsapp/webhook/route'),
    fns: await import('../../src/services/inngest/functions'),
    payment: await import('../../src/services/billing/paymentReceivedNotice'),
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    Audit: (await import('../../src/models/Audit')).default,
    Subscription: (await import('../../src/models/Subscription')).default,
    SalesConversation: (await import('../../src/models/SalesConversation')).default,
    Lead: (await import('../../src/models/Lead')).default,
  };
});
after(async () => {
  console.error = origError;
  console.warn = origWarn;
  loader._load = prevLoad;
  await stopMemoryDb();
});
beforeEach(() => {
  calls.length = 0;
  logs.length = 0;
  nextError = null;
  errorQueue = [];
});

let seq = 0;
const phone = () => `+9197100${String(++seq).padStart(5, '0')}`;
/** A platform lead with a name — the notification template's {{1}} needs a real name ("Hi there" is never sent). */
const namedPhone = async (name = 'Asha Rao') => {
  const p = phone();
  await m.Lead.create({ tenantId: 'gmbboost-internal', name, phone: p } as any);
  return p;
};
const national = (p: string) => p.slice(3);

test('diagnostics: every Twilio failure stays distinguishable; logs never carry a full number', (t) => {
  if (skipReason) return t.skip(skipReason);
  const k = m.diag.classifyTwilioError;
  assert.equal(k('20003'), 'AUTHENTICATION_FAILED');
  assert.equal(k(20429), 'RATE_LIMITED');
  assert.equal(k('21211'), 'RECIPIENT_INVALID');
  assert.equal(k('21655'), 'CONTENT_SID_INVALID');
  assert.equal(k('21656'), 'CONTENT_VARIABLES_INVALID');
  assert.equal(k('63027'), 'TEMPLATE_NOT_APPROVED_FOR_LOCALE');
  assert.equal(k('63016'), 'OUTSIDE_SESSION_WINDOW');
  assert.equal(k('63049'), 'META_DECLINED_MARKETING');
  assert.equal(k('99999'), 'SEND_FAILED', 'unknown codes are never guessed');
  assert.equal(m.diag.redactPhone('+919876543210'), '+91******3210');
  assert.equal(m.diag.safeSidRef(LIVE.TWILIO_TEMPLATE_NOTIFICATION), 'HX955e07…');
  assert.doesNotMatch(m.diag.redactText('Invalid To: +91 98765 43210'), /98765/);
});

test('template send: accepted → SENT with a correlation id; the login code is never stored', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = phone();
  const res = await m.twilio.sendTemplateMessage(p, LIVE.TWILIO_TEMPLATE_LOGIN_OTP, { '1': '482913' });
  assert.equal(res.success, true);
  assert.ok(res.correlationId);
  const row: any = await m.MessageQueue.findById(res.correlationId).lean();
  assert.equal(row.status, 'SENT');
  assert.equal(row.payload.sid, res.sid);
  assert.deepEqual(row.payload.variables, { '1': '[redacted]' }, 'OTP not persisted');
  assert.equal(calls[0].variables!['1'], '482913', 'the code still reaches Twilio');
  assert.equal(row.deliveredAt, undefined, 'never "delivered" without a callback');
});

test('Twilio rejections are recorded with code + kind, nothing is substituted, and logs are redacted', async (t) => {
  if (skipReason) return t.skip(skipReason);
  for (const [code, kind] of [[21656, 'CONTENT_VARIABLES_INVALID'], [21655, 'CONTENT_SID_INVALID'], [63027, 'TEMPLATE_NOT_APPROVED_FOR_LOCALE'], [20003, 'AUTHENTICATION_FAILED'], [20429, 'RATE_LIMITED'], [21211, 'RECIPIENT_INVALID']] as const) {
    calls.length = 0;
    logs.length = 0;
    const p = phone();
    nextError = { code, message: `Twilio says no for ${p}` };
    const res = await m.twilio.sendTemplateMessage(p, LIVE.TWILIO_TEMPLATE_PAYMENT_RECEIVED, { '1': 'Asha' });
    assert.equal(res.success, false);
    assert.equal(res.errorKind, kind, String(code));
    assert.equal(res.errorCode, String(code));
    assert.equal(calls.length, 1, 'no second attempt with another template');
    const row: any = await m.MessageQueue.findById(res.correlationId).lean();
    assert.equal(row.status, 'FAILED');
    assert.equal(row.errorKind, kind);
    const line = logs.join('\n');
    assert.match(line, new RegExp(`"errorCode":"${code}"`));
    assert.match(line, /"sidRef":"HXc4db24…"/);
    assert.ok(!line.includes(national(p)), 'the recipient number never appears in full');
  }
});

test('missing Content SID or invalid variables: TEMPLATE_CONFIG_MISSING / CONTENT_VARIABLES_INVALID, Twilio never called', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const none = await m.twilio.sendTemplateMessage(phone(), '', { '1': 'x' });
  assert.equal(none.errorKind, 'TEMPLATE_CONFIG_MISSING');
  const bad = await m.twilio.sendTemplateMessage(phone(), LIVE.TWILIO_TEMPLATE_NOTIFICATION, { '1': 'Asha', '2': '' });
  assert.equal(bad.success, false);
  assert.equal(bad.errorKind, 'CONTENT_VARIABLES_INVALID');
  assert.equal(calls.length, 0);
});

test('login OTP: only the approved authentication template, never free text; missing config is explicit', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = phone();
  const ok = await m.send.sendOtpMessage(p, 'Your code is 551177', '551177');
  assert.equal(ok.success, true);
  assert.deepEqual(calls.map((c) => [c.contentSid, c.variables]), [[LIVE.TWILIO_TEMPLATE_LOGIN_OTP, { '1': '551177' }]]);

  calls.length = 0;
  nextError = { code: 63027, message: 'template not found for locale' };
  const failed = await m.send.sendOtpMessage(phone(), 'Your code is 551177', '551177');
  assert.equal(failed.errorKind, 'TEMPLATE_NOT_APPROVED_FOR_LOCALE');
  assert.equal(calls.length, 1, 'no free-text retry with the code in it');

  const saved = m.templates.WA_TEMPLATES.loginOtp;
  (m.templates.WA_TEMPLATES as any).loginOtp = '';
  try {
    calls.length = 0;
    const missing = await m.send.sendOtpMessage(phone(), 'Your code is 551177', '551177');
    assert.equal(missing.errorKind, 'TEMPLATE_CONFIG_MISSING');
    assert.match(missing.error, /growwmatics_login_otp/);
    assert.equal(calls.length, 0, 'the code is never sent as free text');
  } finally {
    (m.templates.WA_TEMPLATES as any).loginOtp = saved;
  }
});

test('WHATSAPP_PROVIDER=meta without Meta configured fails visibly — never switches to Twilio', async (t) => {
  if (skipReason) return t.skip(skipReason);
  process.env.WHATSAPP_PROVIDER = 'meta';
  try {
    const res = await m.send.sendOutboundMessage(phone(), 'hello');
    assert.equal(res.errorKind, 'PROVIDER_CONFIG_MISSING');
    const otp = await m.send.sendOtpMessage(phone(), 'code', '123456');
    assert.equal(otp.errorKind, 'PROVIDER_CONFIG_MISSING');
    assert.equal(calls.length, 0);
  } finally {
    process.env.WHATSAPP_PROVIDER = 'twilio';
  }
});

test('business-initiated message outside the 24h window → the approved notification template with exactly {{1}},{{2}}', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const res = await m.send.sendOutboundMessage(phone(), 'Hi Asha,\nYour demo is tomorrow at 11:00 AM.', undefined, undefined, undefined, 'Asha');
  assert.equal(res.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].contentSid, LIVE.TWILIO_TEMPLATE_NOTIFICATION);
  assert.deepEqual(Object.keys(calls[0].variables!).sort(), LIVE_PLACEHOLDERS[LIVE.TWILIO_TEMPLATE_NOTIFICATION]);
  assert.doesNotMatch(calls[0].variables!['2'], /\n/, '{{2}} is one line (Twilio 21656)');

  const saved = m.templates.WA_TEMPLATES.notification;
  (m.templates.WA_TEMPLATES as any).notification = '';
  try {
    calls.length = 0;
    const missing = await m.send.sendOutboundMessage(phone(), 'Your demo is tomorrow.');
    assert.equal(missing.errorKind, 'TEMPLATE_CONFIG_MISSING');
    assert.equal(calls.length, 0, 'no free text to a closed window');
  } finally {
    (m.templates.WA_TEMPLATES as any).notification = saved;
  }
});

test('63016 on free text inside a (believed) open window: one logged notification-template recovery; its failure is returned', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await namedPhone();
  m.send.noteInboundMessage(p); // the window looks open locally
  nextError = { code: 63016, message: 'outside the allowed window' };
  const res = await m.send.sendOutboundMessage(p, 'Here are your report findings.');
  assert.equal(res.success, true);
  assert.equal(calls[1]?.variables?.['1'], 'Asha', 'the real first name');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].contentSid, LIVE.TWILIO_TEMPLATE_NOTIFICATION);
  assert.ok(res.recoveredFrom, 'the success points at the failed attempt');
  assert.match(logs.join('\n'), /"event":"whatsapp_send_recovered".*"errorCode":"63016"/);

  // The recovery itself rejected: the caller gets a failure (with both reasons), never a success.
  calls.length = 0;
  const q = await namedPhone();
  m.send.noteInboundMessage(q);
  errorQueue = [{ code: 63016, message: 'outside the allowed window' }, { code: 21656, message: 'ContentVariables invalid' }];
  const failed = await m.send.sendOutboundMessage(q, 'Here are your report findings.');
  assert.equal(failed.success, false);
  assert.equal(failed.errorKind, 'CONTENT_VARIABLES_INVALID');
  assert.match(failed.error, /template fallback also failed/);
  assert.equal(calls.length, 2, 'bounded: one recovery attempt, no third');

  // No known name: the recovery is refused visibly (product rule: never "Hi there"), not sent as something else.
  calls.length = 0;
  const unnamed = phone();
  m.send.noteInboundMessage(unnamed);
  nextError = { code: 63016, message: 'outside the allowed window' };
  const refused = await m.send.sendOutboundMessage(unnamed, 'Here are your report findings.');
  assert.equal(refused.success, false);
  assert.equal(refused.errorKind, 'CONTENT_VARIABLES_INVALID');
  assert.match(refused.error, /\{\{1\}\} is empty/);
  assert.equal(calls.length, 1);
});

test('delivery callbacks: delivered/read are recorded as evidence; a failure keeps its code and kind', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const res = await m.twilio.sendTemplateMessage(phone(), LIVE.TWILIO_TEMPLATE_PAYMENT_RECEIVED, { '1': 'Asha' });
  const post = async (fields: Record<string, string>) => {
    const url = 'https://app.example.test/api/webhook/twilio/status';
    const signature = realTwilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, fields);
    const form = new URLSearchParams(fields);
    return m.status.POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature, 'x-forwarded-proto': 'https', host: 'app.example.test' }, body: form.toString() }));
  };
  await post({ MessageSid: res.sid, MessageStatus: 'delivered' });
  let row: any = await m.MessageQueue.findById(res.correlationId).lean();
  assert.ok(row.deliveredAt, 'delivery evidence recorded');
  assert.equal(row.status, 'SENT', '"accepted" status unchanged for existing counts');
  await post({ MessageSid: res.sid, MessageStatus: 'read' });
  row = await m.MessageQueue.findById(res.correlationId).lean();
  assert.ok(row.readAt);

  const fail = await m.twilio.sendTemplateMessage(phone(), LIVE.TWILIO_TEMPLATE_REPORT_READY, { '1': 'A', '2': 'B', '3': 'abc' });
  await post({ MessageSid: fail.sid, MessageStatus: 'undelivered', ErrorCode: '63049', ErrorMessage: 'Meta chose not to deliver' });
  row = await m.MessageQueue.findById(fail.correlationId).lean();
  assert.equal(row.status, 'FAILED');
  assert.equal(row.errorCode, '63049');
  assert.equal(row.errorKind, 'META_DECLINED_MARKETING');

  // Async 63016 on free text: one template recovery, never a second for a repeated callback.
  const p = await namedPhone();
  m.send.noteInboundMessage(p);
  const free = await m.send.sendOutboundMessage(p, 'Your report is ready.');
  calls.length = 0;
  await post({ MessageSid: free.sid, MessageStatus: 'undelivered', ErrorCode: '63016', ErrorMessage: 'outside window' });
  await post({ MessageSid: free.sid, MessageStatus: 'undelivered', ErrorCode: '63016', ErrorMessage: 'outside window' });
  assert.equal(calls.length, 1, 'exactly one recovery for a redelivered callback');
  assert.equal(calls[0].contentSid, LIVE.TWILIO_TEMPLATE_NOTIFICATION);
  assert.match(logs.join('\n'), /async 63016/);
});

test('contract: report-ready sends {{1}},{{2}} and the bare auditId as {{3}} (the button URL adds the rest)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = phone();
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: 'Asha Bakery', category: 'Bakery', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId() } as any);
  await m.User.create({ _id: userId, fullName: 'Asha Rao', email: 'asha-rr@example.invalid', phone: p, role: 'CLIENT' } as any);
  const audit = await m.Audit.create({ tenantId: String(b._id), userId: String(userId), organizationId: 'org', businessId: b._id, businessName: b.name, location: 'Pune', status: 'COMPLETED', fastMode: true } as any);
  const step = { run: async (_n: string, cb: () => any) => cb(), sleep: async () => {}, sendEvent: async () => {} };
  await m.fns.sendReportReadyNotification.fn({ event: { data: { auditId: String(audit._id) } }, step });
  const sent = calls.find((c) => c.contentSid === LIVE.TWILIO_TEMPLATE_REPORT_READY)!;
  assert.deepEqual(Object.keys(sent.variables!).sort(), LIVE_PLACEHOLDERS[LIVE.TWILIO_TEMPLATE_REPORT_READY]);
  assert.equal(sent.variables!['3'], String(audit._id), 'not a full URL — the approved button already has ?auditId=');
  assert.equal(sent.variables!['2'], 'Asha Bakery');

  const saved = m.templates.WA_TEMPLATES.reportReady;
  (m.templates.WA_TEMPLATES as any).reportReady = '';
  try {
    calls.length = 0;
    logs.length = 0;
    const out = await m.fns.sendReportReadyNotification.fn({ event: { data: { auditId: String(audit._id) } }, step });
    assert.equal(calls.length, 0);
    assert.match(logs.join('\n'), /TEMPLATE_CONFIG_MISSING.*copy_of_growwmatics_report_ready/);
    void out;
  } finally {
    (m.templates.WA_TEMPLATES as any).reportReady = saved;
  }
});

test('contract: payment_received {{1}} only; review requests: Utility {{3}} = token, legacy {{3}} = Place ID', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = phone();
  const userId = new m.mongoose.Types.ObjectId();
  await m.User.create({ _id: userId, fullName: 'Ravi Kumar', email: 'ravi-pr@example.invalid', phone: p, role: 'CLIENT' } as any);
  await m.Subscription.create({ userId, planType: 'Pro', billingStatus: 'Active' } as any);
  await m.payment.sendPaymentReceivedMessage(String(userId), null);
  const sent = calls.find((c) => c.contentSid === LIVE.TWILIO_TEMPLATE_PAYMENT_RECEIVED)!;
  assert.deepEqual(sent.variables, { '1': 'Ravi' });

  const utility = m.review.buildUtilityReviewVariables('Meera', 'Glow Salon', 'tok123');
  assert.deepEqual(Object.keys(utility).sort(), LIVE_PLACEHOLDERS[LIVE.TWILIO_TEMPLATE_REVIEW_REQUEST_UTILITY]);
  assert.equal(utility['3'], 'tok123', 'the token only — the button is /review/{{3}}');
  const legacy = m.review.buildLegacyReviewVariables('Meera', 'Glow Salon', 'ChIJplace');
  assert.deepEqual(Object.keys(legacy).sort(), LIVE_PLACEHOLDERS[LIVE.TWILIO_TEMPLATE_REVIEW_REQUEST]);
  assert.equal(legacy['3'], 'ChIJplace', 'the Place ID only — the button already has ?placeid=');
});

test('"view my report" inside the session: one free-text reply with the link, no template attempted', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = phone();
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: 'Kiran Cafe', category: 'Cafe', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId() } as any);
  await m.User.create({ _id: userId, fullName: 'Kiran', email: 'kiran-vr@example.invalid', phone: p, role: 'CLIENT', isPhoneVerified: false } as any);
  await m.Audit.create({ tenantId: String(b._id), userId: String(userId), organizationId: 'org', businessId: b._id, businessName: b.name, location: 'Pune', status: 'COMPLETED', fastMode: true } as any);
  const fields = { MessageSid: `SMvr${Date.now()}`, From: `whatsapp:${p}`, To: 'whatsapp:+10000000000', Body: 'view report', NumMedia: '0' };
  process.env.PLATFORM_WHATSAPP_NUMBER = '+10000000000';
  const url = 'https://app.example.test/api/whatsapp/webhook';
  const signature = realTwilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, fields);
  await m.webhook.handleTwilioWebhook(new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature, 'x-forwarded-proto': 'https', host: 'app.example.test' }, body: new URLSearchParams(fields).toString() }));
  const mine = calls.filter((c) => c.to === `whatsapp:${p}`);
  assert.ok(mine.length >= 1);
  assert.ok(mine.every((c) => !c.contentSid), 'free text only — no template whose failure could be hidden');
});
