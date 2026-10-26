/**
 * Outbound suppression (lib/outboundSuppression.ts) — the REAL senders
 * (Twilio + Meta WhatsApp, Resend/SendGrid email, Expo push, billing
 * reminders) against an in-memory MongoDB. The provider SDKs (twilio, resend,
 * nodemailer) and fetch are replaced by spies, and every credential is fake:
 * nothing can reach a real provider either way.
 *
 * Each channel is run twice: suppressed (no provider call may happen) and,
 * as a control, with suppression deliberately off (the spy must see the
 * call — proves the spies sit on the real provider path).
 *
 * Run: npm run test:workflow
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

type Call = { provider: string; detail: string };
const calls: Call[] = [];
const record = (provider: string, detail: string) => calls.push({ provider, detail });
const providerCalls = () => calls.splice(0);

// ── Provider spies — installed before any app module loads ───────────────
const twilioSpy = () => ({
  messages: {
    create: async (p: any) => {
      record('twilio', `${p.contentSid ? 'template' : 'message'} → ${p.to}`);
      return { sid: `SMspy${calls.length}` };
    },
  },
});
const resendSpy = {
  Resend: class {
    emails = {
      send: async (p: any) => {
        record('resend', `${p.subject} → ${p.to}`);
        return { data: { id: 'resend_spy' }, error: null };
      },
    };
  },
};
const nodemailerSpy = {
  createTransport: () => ({
    sendMail: async (p: any) => {
      record('sendgrid', `${p.subject} → ${p.to}`);
      return { messageId: 'sendgrid_spy' };
    },
  }),
};
const loader = Module as any;
const originalLoad = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
  if (request === 'twilio') return twilioSpy;
  if (request === 'resend') return resendSpy;
  if (request === 'nodemailer') return nodemailerSpy;
  return originalLoad.call(this, request, ...rest);
};

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return originalFetch(input, init);
  if (url.includes('graph.facebook.com')) {
    record('meta', JSON.parse(String(init?.body ?? '{}')).type ?? 'unknown');
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.spy' }] }), { status: 200 });
  }
  if (url.includes('content.twilio.com')) {
    record('twilio-content', url);
    return new Response(JSON.stringify({ sid: 'HXspy' }), { status: 201 });
  }
  if (url.includes('exp.host')) {
    record('expo', url);
    return new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 });
  }
  record('other', url);
  return new Response('{}', { status: 599 });
}) as typeof fetch;

// ── Fake configuration (never real credentials) ──────────────────────────
Object.assign(process.env, {
  TWILIO_ACCOUNT_SID: 'ACtest_not_real',
  TWILIO_AUTH_TOKEN: 'test_not_real',
  TWILIO_WHATSAPP_NUMBER: '+10000000000',
  TWILIO_TEMPLATE_LOGIN_OTP: 'HX' + 'a'.repeat(32),
  META_WHATSAPP_ACCESS_TOKEN: 'meta_test_not_real',
  META_WHATSAPP_PHONE_NUMBER_ID: '000000000',
  RESEND_API_KEY: 're_test_not_real',
  RESEND_FROM_EMAIL: 'QA <qa@example.invalid>',
  SENDGRID_API_KEY: 'SG.test_not_real',
});
delete process.env.TWILIO_MESSAGING_SERVICE_SID;
delete process.env.TWILIO_STATUS_CALLBACK_URL;

const PHONE = '+919000000001';
const EMAIL = 'owner@example.invalid';
const TEMPLATE = 'HX' + 'b'.repeat(32);

function setSuppression(on: boolean) {
  for (const k of ['QA_SUPPRESS_WHATSAPP_SENDS', 'QA_SUPPRESS_EMAIL_SENDS', 'QA_SUPPRESS_PUSH_SENDS']) process.env[k] = on ? 'true' : 'false';
}

let memoryServer: any = null;
let skipReason: string | null = null;
let app: any = {};

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_suppression_${Date.now()}`);
  const dbConnect = (await import('../../src/lib/mongodb')).default;
  await dbConnect();
  app = {
    twilio: await import('../../src/services/twilio/client'),
    send: await import('../../src/services/whatsapp/send'),
    email: await import('../../src/services/email'),
    push: await import('../../src/services/push'),
    reminders: await import('../../src/lib/billing/recoveryReminders'),
    policy: await import('../../src/lib/billing/billingPolicy'),
    Episode: (await import('../../src/models/BillingRecoveryEpisode')).default,
    User: (await import('../../src/models/User')).default,
    mongoose: (await import('mongoose')).default,
  };
  providerCalls();
});

after(async () => {
  if (app.mongoose?.connection?.readyState === 1) {
    await app.mongoose.connection.dropDatabase();
    await app.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
  loader._load = originalLoad;
  globalThis.fetch = originalFetch;
});

/** Runs `send` suppressed (expects no provider call) then unsuppressed (expects `provider`). */
async function both(t: any, provider: string, send: () => Promise<any>) {
  if (skipReason) return t.skip(skipReason);
  setSuppression(true);
  const r = await send();
  assert.equal(r?.success ?? true, true, 'a suppressed send resolves as a success');
  assert.deepEqual(providerCalls(), [], 'suppressed: no provider was contacted');

  setSuppression(false);
  await send();
  const seen = providerCalls();
  assert.ok(seen.some((c) => c.provider === provider), `control: expected a ${provider} call, saw ${JSON.stringify(seen)}`);
  setSuppression(true);
}

test('WhatsApp OTP (Twilio auth template) — suppressed: no Twilio call', (t) =>
  both(t, 'twilio', () => {
    process.env.WHATSAPP_PROVIDER = 'twilio';
    return app.send.sendOtpMessage(PHONE, 'Your code is 123456', '123456');
  }));

test('WhatsApp OTP via Meta: no approved authentication template there — refused visibly, never sent as text', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const saved = process.env.WHATSAPP_PROVIDER;
  process.env.WHATSAPP_PROVIDER = 'meta';
  try {
    for (const suppressed of [true, false]) {
      setSuppression(suppressed);
      providerCalls();
      const res = await app.send.sendOtpMessage(PHONE, 'Your code is 123456', '123456');
      assert.equal(res.success, false);
      assert.equal(res.errorKind, 'TEMPLATE_CONFIG_MISSING');
      assert.deepEqual(providerCalls(), [], 'no Graph API call, no Twilio call');
    }
  } finally {
    setSuppression(true);
    if (saved === undefined) delete process.env.WHATSAPP_PROVIDER;
    else process.env.WHATSAPP_PROVIDER = saved;
  }
});

test('email OTP — suppressed: no Resend or SendGrid call', (t) =>
  both(t, 'resend', () => app.email.sendEmailOtp(EMAIL, '123456', 'verify', 10)));

test('transactional email — suppressed: no Resend or SendGrid call', (t) =>
  both(t, 'resend', () => app.email.sendTransactionalEmail(EMAIL, 'Your invoice', '<p>Invoice</p>')));

test('review-request email (SendGrid) — suppressed: no SendGrid call', (t) =>
  both(t, 'sendgrid', () => app.email.sendEmail(EMAIL, 'Asha', 'Haircut', 'https://g.page/r/x', 'Asha Salon')));

test('WhatsApp template (Twilio) — suppressed: no Twilio call', (t) =>
  both(t, 'twilio', () => app.twilio.sendTemplateMessage(PHONE, TEMPLATE, { '1': 'Asha', '2': 'Your report is ready' })));

test('WhatsApp template (Meta) — suppressed: no Graph API call', (t) =>
  both(t, 'meta', () => import('../../src/services/whatsapp/meta').then((m) => m.sendMetaTemplate(PHONE, 'utility', 'en', ['Asha']))));

test('interactive WhatsApp (quick reply + list) — suppressed: no Content API or Twilio call', async (t) => {
  await both(t, 'twilio-content', () => app.twilio.sendQuickReply(PHONE, 'Pick one', [{ id: 'a', title: 'Yes' }, { id: 'b', title: 'No' }]));
  await both(t, 'twilio-content', () => app.twilio.sendListPicker(PHONE, 'Pick a slot', 'Slots', [{ id: 's1', item: 'Mon 10:00' }]));
});

test('push notification — suppressed: no Expo call', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const user = await app.User.create({ fullName: 'Push Owner', email: 'push@example.invalid', phone: '+919000000002', role: 'CLIENT', pushTokens: ['ExponentPushToken[spy]'] } as any);
  await both(t, 'expo', async () => {
    await app.push.sendPushToUser(String(user._id), { title: 'New lead', body: 'Asha enquired' });
    return { success: true };
  });
});

test('billing recovery reminder (service wiring: sendTemplateMessage) — suppressed: no Twilio call', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { parseReminderPolicy } = app.policy;
  const { openEpisode, runRecoveryReminders } = app.reminders;
  // Enabled only inside this throwaway in-memory database — never stored config.
  const policy = parseReminderPolicy({
    reminders: {
      enabled: true, steps: [{ offsetDays: 0 }], maxReminders: 1, sendingHours: { start: 9, end: 20 },
      timezone: 'Asia/Kolkata', retry: { maxAttempts: 3, backoffMinutes: 30 }, template: { contentSid: TEMPLATE, approved: true },
    },
  });
  assert.equal(policy.enabled, true);
  const T = new Date('2027-01-15T04:30:00.000Z'); // 10:00 IST, inside sending hours
  const oid = () => new app.mongoose.Types.ObjectId();
  const run = async () => {
    await openEpisode(app.Episode, { businessId: oid(), userId: oid(), razorpaySubscriptionId: `sub_${Date.now()}`, failureKind: 'renewal', failedAt: T, policy });
    const summary = await runRecoveryReminders({
      Episode: app.Episode,
      now: () => T,
      policy,
      loadContext: async () => ({ phone: PHONE, variables: { '1': 'Asha', '2': 'Asha Bakery' } }),
      send: (phone: string, sid: string, vars: Record<string, string>) => app.twilio.sendTemplateMessage(phone, sid, vars),
    });
    assert.ok(summary.sent >= 1, `reminder counted as sent: ${JSON.stringify(summary)}`);
    return { success: true };
  };
  await both(t, 'twilio', run);
});

test('unset flags: suppressed outside production, sending in production', async () => {
  const { outboundSuppressed } = await import('../../src/lib/outboundSuppression');
  const saved = { ...process.env };
  try {
    for (const k of ['QA_SUPPRESS_WHATSAPP_SENDS', 'QA_SUPPRESS_EMAIL_SENDS', 'QA_SUPPRESS_PUSH_SENDS']) delete process.env[k];
    (process.env as any).NODE_ENV = 'development';
    assert.equal(outboundSuppressed('whatsapp'), true);
    assert.equal(outboundSuppressed('email'), true);
    assert.equal(outboundSuppressed('push'), true);
    (process.env as any).NODE_ENV = 'production';
    assert.equal(outboundSuppressed('whatsapp'), false);
    assert.equal(outboundSuppressed('email'), false);
    process.env.QA_SUPPRESS_EMAIL_SENDS = 'TRUE';
    assert.equal(outboundSuppressed('email'), true, 'explicit true wins in production');
    (process.env as any).NODE_ENV = 'development';
    process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'false';
    assert.equal(outboundSuppressed('whatsapp'), false, 'explicit false allows a deliberate local round-trip');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
