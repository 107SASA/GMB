/**
 * Security log — the REAL sign-in, password-reset and webhook routes write
 * models/SecurityEvent.ts with outcome, IP and device; secrets are never
 * stored; repeated failed super admin sign-ins raise ONE alert; only a super
 * admin can read the log. In-memory MongoDB, nothing sent anywhere.
 *
 * Run: npx tsx --test tests/workflow/security-log.test.ts
 */
import { signInAsSuperAdmin, signOut, signInAs, startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_not_real';
process.env.TWILIO_AUTH_TOKEN = 'test_not_real_token';

let skipReason: string | null = null;
let m: any = {};
let admin: any;
const PASSWORD = 'Correct-Horse-9!';
const BASE = 'https://app.example.test';

before(async () => {
  skipReason = await startMemoryDb('security_log');
  if (skipReason) return;
  const bcrypt = (await import('bcryptjs')).default;
  m = {
    adminAuth: await import('../../src/app/api/admin/auth/route'),
    login: await import('../../src/app/api/auth/login/route'),
    forgot: await import('../../src/app/api/auth/forgot-password/route'),
    razorpay: await import('../../src/app/api/webhook/razorpay/route'),
    twilioSig: await import('../../src/lib/twilioSignature'),
    events: await import('../../src/app/api/admin/security/events/route'),
    log: await import('../../src/services/security/securityLog'),
    SecurityEvent: (await import('../../src/models/SecurityEvent')).default,
    User: (await import('../../src/models/User')).default,
  };
  admin = await m.User.create({ fullName: 'Sec Admin', email: 'sec-admin@example.invalid', phone: '+919811100001', role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(PASSWORD, 4) } as any);
});
after(stopMemoryDb);

const post = (route: any, path: string, body: unknown, ip = '203.0.113.7') =>
  route.POST(new Request(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip, 'user-agent': 'Mozilla/5.0 (Macintosh; Mac OS X) Chrome/130' }, body: JSON.stringify(body) }));
const eventsOf = (filter: Record<string, unknown>) => m.SecurityEvent.find(filter).sort({ createdAt: 1 }).lean();

test('super admin sign-in: failure and success recorded with email, IP and device — never the password', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const bad = await post(m.adminAuth, '/api/admin/auth', { email: 'sec-admin@example.invalid', password: 'wrong-password-1' }, '198.51.100.1');
  assert.equal(bad.status, 401);
  const ok = await post(m.adminAuth, '/api/admin/auth', { email: 'SEC-ADMIN@example.invalid', password: PASSWORD }, '198.51.100.1');
  assert.equal(ok.status, 200);
  const rows: any[] = await eventsOf({ type: 'admin.login', ip: '198.51.100.1' });
  assert.deepEqual(rows.map((r) => r.outcome), ['failure', 'success']);
  assert.equal(rows[0].subject, 'sec-admin@example.invalid');
  assert.equal(rows[0].severity, 'warning');
  assert.equal(String(rows[1].userId), String(admin._id));
  assert.match(rows[1].userAgent, /Chrome/);
  const all = JSON.stringify(await m.SecurityEvent.find({}).lean());
  assert.ok(!all.includes(PASSWORD) && !all.includes('wrong-password-1'), 'no password ever stored');
});

test('repeated failed super admin sign-ins from one IP: blocked after 5, one alert raised (not one per attempt)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ip = '192.0.2.50';
  const statuses = [];
  for (let i = 0; i < 8; i++) statuses.push((await post(m.adminAuth, '/api/admin/auth', { email: 'sec-admin@example.invalid', password: `guess-${i}` }, ip)).status);
  assert.ok(statuses.includes(429), 'the existing rate limit blocks');
  const rows: any[] = await eventsOf({ type: 'admin.login', ip });
  assert.equal(rows.length, 8);
  assert.ok(rows.some((r) => r.outcome === 'blocked'));
  const alerts: any[] = await eventsOf({ type: 'security.alert' });
  assert.equal(alerts.length, 1, 'once per hour, not per attempt');
  assert.equal(alerts[0].severity, 'critical');
  assert.match(alerts[0].detail, /from 192\.0\.2\.50/);
});

test('password sign-in and password-reset request are logged; the reset request never reveals whether the email exists', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const res = await post(m.login, '/api/auth/login', { email: 'nobody@example.invalid', password: 'whatever-1' }, '203.0.113.20');
  assert.equal(res.status, 401);
  assert.equal((await eventsOf({ type: 'auth.login', ip: '203.0.113.20' }))[0].outcome, 'failure');
  await post(m.forgot, '/api/auth/forgot-password', { email: 'nobody@example.invalid' }, '203.0.113.21');
  const reset: any[] = await eventsOf({ type: 'auth.password_reset_request', ip: '203.0.113.21' });
  assert.equal(reset.length, 1);
  assert.equal(reset[0].outcome, 'info', 'same outcome whether or not the account exists');
});

test('webhooks with a bad signature are recorded (Razorpay, Twilio)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const rz = await m.razorpay.POST(new Request(`${BASE}/api/webhook/razorpay`, { method: 'POST', headers: { 'x-razorpay-signature': 'forged', 'x-real-ip': '198.51.100.99' }, body: '{"event":"subscription.charged"}' }));
  assert.ok([400, 401, 403].includes(rz.status), String(rz.status));
  const fd = new FormData();
  fd.append('From', 'whatsapp:+919000000001');
  const tw = await m.twilioSig.validateTwilioSignature(new Request(`${BASE}/api/whatsapp/webhook`, { method: 'POST', headers: { 'x-twilio-signature': 'forged', 'x-real-ip': '198.51.100.98' } }), fd);
  assert.equal(tw.ok, false);
  const rows: any[] = await eventsOf({ type: 'webhook.signature_invalid' });
  assert.deepEqual(rows.map((r) => r.metadata.provider).sort(), ['razorpay', 'twilio']);
  assert.ok(rows.every((r) => r.outcome === 'blocked'));
});

test('phones are masked; only a super admin can read the log; filters and the 24h summary work', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal(m.log.maskPhone('+919876543210'), '+91******3210');
  assert.equal(m.log.phoneSubject({ phone: '98765 43210' }), '+91******3210');

  signOut();
  assert.equal((await m.events.GET(new Request(`${BASE}/api/admin/security/events`))).status, 401);
  const client: any = await m.User.create({ fullName: 'Client', email: 'client-sec@example.invalid', phone: '+919811100002', role: 'CLIENT' } as any);
  await signInAs(client);
  assert.equal((await m.events.GET(new Request(`${BASE}/api/admin/security/events`))).status, 403);
  await signInAsSuperAdmin('sec-reader@example.invalid');

  const json = await (await m.events.GET(new Request(`${BASE}/api/admin/security/events?type=admin.login&outcome=blocked`))).json();
  assert.equal(json.success, true);
  assert.ok(json.events.length > 0 && json.events.every((e: any) => e.type === 'admin.login' && e.outcome === 'blocked'));
  assert.ok(json.summary.adminFailed24 >= 9);
  assert.equal(json.summary.alerts.length, 1);
  const byIp = await (await m.events.GET(new Request(`${BASE}/api/admin/security/events?q=192.0.2.50`))).json();
  assert.ok(byIp.events.every((e: any) => e.ip === '192.0.2.50' || (e.detail || '').includes('192.0.2.50')));
});
