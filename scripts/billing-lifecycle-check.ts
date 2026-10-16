/**
 * End-to-end check of the Razorpay subscription lifecycle through the REAL
 * Next.js routes: signed webhook → services/billing/billingEvents.ts →
 * entitlement writes → MongoDB → /api/billing/status, /api/billing/trial-offer,
 * /api/admin/billing-policy.
 *
 * Isolation (nothing leaves this machine):
 *  - MongoDB is a throwaway in-memory server (mongodb-memory-server); the
 *    Atlas MONGODB_URI from .env is never used.
 *  - Every key found in .env / .env.local is BLANKED in the server process
 *    (Next won't override an existing, even empty, variable), so Razorpay,
 *    Twilio/WhatsApp, email, Spaces, Google and AI providers are all
 *    unconfigured. QA_SUPPRESS_WHATSAPP_SENDS=true on top.
 *  - Webhooks are signed with a throwaway secret generated per run.
 *  - Inngest points at a local fake event endpoint (records sent events,
 *    answers 200) — a valid test configuration; no job actually runs.
 *
 * What it can't cover: Razorpay itself (checkout widget, real mandate
 * authorization, real charges/expiry). That needs Razorpay test mode.
 *
 * Run: node --experimental-strip-types scripts/billing-lifecycle-check.ts
 */
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { SignJWT } from 'jose';

const PORT = 3917;
const INNGEST_PORT = 3918;
const BASE = `http://localhost:${PORT}`;
const WEBHOOK_SECRET = `whsec_test_${crypto.randomBytes(8).toString('hex')}`;
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const DAY = 86_400_000;

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

function envKeysFromFiles(): string[] {
  const keys = new Set<string>();
  for (const f of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
      if (m) keys.add(m[1]);
    }
  }
  return [...keys];
}

async function waitForServer(child: ChildProcess) {
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next dev exited (${child.exitCode})`);
    try {
      const res = await fetch(`${BASE}/api/billing/plans`);
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('next dev did not come up in time');
}

const oid = () => new mongoose.Types.ObjectId();

async function main() {
  const binary = path.resolve('node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.6.exe');
  const mem = await MongoMemoryServer.create(fs.existsSync(binary) ? { binary: { systemBinary: binary } } : {});
  const uri = mem.getUri('gm_billing_check');
  if (!uri.startsWith('mongodb://127.0.0.1') && !uri.startsWith('mongodb://localhost')) throw new Error(`refusing non-local DB: ${uri}`);
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  console.log(`[check] in-memory MongoDB ${uri}`);

  // ── seed ──
  const now = Date.now();
  const trialEnd = new Date(now + 92 * DAY);
  trialEnd.setUTCMilliseconds(0);
  const mkUser = async (phone: string, role = 'CLIENT') => {
    const _id = oid();
    await db.collection('users').insertOne({
      _id, fullName: 'Check User', email: `${_id}@example.invalid`, phone, role, isPhoneVerified: true,
      phoneVerifiedAt: new Date(), sessionEpoch: 0, subscriptionPlan: 'Free', businessIds: [], createdAt: new Date(), updatedAt: new Date(),
    });
    await db.collection('subscriptions').insertOne({ userId: _id, planType: 'Free', billingStatus: 'Active', trialStatus: { isActive: false }, createdAt: new Date() });
    return _id;
  };
  const mkBusiness = async (userId: any, name: string) => {
    const _id = oid();
    await db.collection('businesses').insertOne({ _id, userId, name, subscriptionStatus: 'trialing', freeAuditUsed: true, intakeCompleted: true, createdAt: new Date(), updatedAt: new Date() });
    await db.collection('users').updateOne({ _id: userId }, { $push: { businessIds: _id } as any, $set: { activeBusinessId: _id } });
    return _id;
  };
  const mkClaim = async (userId: any, businessId: any, subId: string, phoneHash: string) => {
    await db.collection('trialclaims').insertOne({
      phoneHash, status: 'reserved', userId, businessId, holderBusinessId: businessId, razorpaySubscriptionId: subId,
      reservedAt: new Date(), reservedUntil: new Date(now + DAY), needsReview: false,
      offer: { trialMonths: 3, trialEndsAt: trialEnd, razorpayPlanId: 'plan_yearly', amountPaise: 999_900, currency: 'INR', policyVersion: 1, decidedAt: new Date() },
      history: [], createdAt: new Date(), updatedAt: new Date(),
    });
  };

  const userA = await mkUser('+919000000001');
  const wsA = await mkBusiness(userA, 'Trial Converts');
  await mkClaim(userA, wsA, 'sub_A', 'hash_A');
  const userB = await mkUser('+919000000002');
  const wsB = await mkBusiness(userB, 'Trial Cancels');
  await mkClaim(userB, wsB, 'sub_B', 'hash_B');
  const userC = await mkUser('+919000000003');
  const wsC = await mkBusiness(userC, 'Paid Monthly');
  const userD = await mkUser('+919000000004');
  const wsD = await mkBusiness(userD, 'Declined Checkout');
  const userE = await mkUser('+919000000005');
  const wsE = await mkBusiness(userE, 'Wrong Amount');
  await mkClaim(userE, wsE, 'sub_E', 'hash_E');
  const userF = await mkUser('+919000000006');
  const wsF = await mkBusiness(userF, 'Not Claim Owner');
  const userG = await mkUser('+919000000007');
  const wsG = await mkBusiness(userG, 'Eligible Preview');
  const admin = await mkUser('+919000000099', 'SUPER_ADMIN');

  // ── fake Inngest event API ──
  const inngestEvents: Array<{ name?: string }> = [];
  const inngest = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '[]');
        for (const e of Array.isArray(parsed) ? parsed : [parsed]) inngestEvents.push(e);
      } catch {
        /* not an event body */
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ids: ['evt_fake'], status: 200 }));
    });
  });
  await new Promise<void>((r) => inngest.listen(INNGEST_PORT, '127.0.0.1', () => r()));

  // ── server ──
  const childEnv: Record<string, string> = { ...process.env } as any;
  for (const key of envKeysFromFiles()) childEnv[key] = '';
  Object.assign(childEnv, {
    MONGODB_URI: uri,
    SESSION_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    QA_SUPPRESS_WHATSAPP_SENDS: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_APP_URL: BASE,
    INNGEST_DEV: `http://127.0.0.1:${INNGEST_PORT}`,
    INNGEST_BASE_URL: `http://127.0.0.1:${INNGEST_PORT}`,
    INNGEST_EVENT_API_BASE_URL: `http://127.0.0.1:${INNGEST_PORT}`,
  });
  delete childEnv.NODE_ENV;
  console.log('[check] starting next dev (credentials blanked)…');
  const child = spawn('npx', ['next', 'dev', '--webpack', '-p', String(PORT)], { env: childEnv as NodeJS.ProcessEnv, shell: true, stdio: ['ignore', 'pipe', 'pipe'] as const });
  const serverLog: string[] = [];
  child.stdout!.on('data', (d: Buffer) => serverLog.push(String(d)));
  child.stderr!.on('data', (d: Buffer) => serverLog.push(String(d)));

  const token = async (userId: any, role = 'CLIENT') =>
    new SignJWT({ userId: String(userId), role, sv: 0 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SESSION_SECRET));
  const get = async (p: string, userId: any, businessId?: any, role = 'CLIENT') =>
    fetch(`${BASE}${p}`, { headers: { cookie: `session=${await token(userId, role)}${businessId ? `; activeBusinessId=${businessId}` : ''}` } });
  const put = async (p: string, userId: any, body: unknown, role = 'CLIENT') =>
    fetch(`${BASE}${p}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: `session=${await token(userId, role)}` }, body: JSON.stringify(body) });

  let eventSeq = 0;
  const send = async (event: string, opts: { sub?: any; payment?: any; createdAt: number; eventId?: string }) => {
    const body = JSON.stringify({
      entity: 'event', event, created_at: Math.floor(opts.createdAt / 1000), contains: [],
      payload: {
        ...(opts.sub && { subscription: { entity: opts.sub } }),
        ...(opts.payment && { payment: { entity: opts.payment } }),
      },
    });
    const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    const res = await fetch(`${BASE}/api/webhook/razorpay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig, 'x-razorpay-event-id': opts.eventId ?? `evt_${++eventSeq}` },
      body,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const trialEntity = (id: string, userId: any, businessId: any, over: Record<string, unknown> = {}) => ({
    id, entity: 'subscription', plan_id: 'plan_yearly', status: 'authenticated', start_at: Math.floor(trialEnd.getTime() / 1000),
    current_start: null, current_end: null, paid_count: 0, customer_id: 'cust_x',
    notes: { userId: String(userId), businessId: String(businessId), planType: 'Pro', billingCycle: 'yearly', trial: '1' }, ...over,
  });
  const biz = (id: any) => db.collection('businesses').findOne({ _id: id });

  try {
    await waitForServer(child);
    console.log('[check] server up\n');

    // Signature
    const unsigned = await fetch(`${BASE}/api/webhook/razorpay`, { method: 'POST', body: '{}', headers: { 'x-razorpay-signature': 'bad' } });
    check('webhook rejects a bad signature (403)', unsigned.status === 403, unsigned.status);

    // A: trial → paid
    const t = now - 60 * 60_000;
    let r = await send('subscription.authenticated', { sub: trialEntity('sub_A', userA, wsA), createdAt: t, eventId: 'evt_auth_A' });
    let a = await biz(wsA);
    check('A: verified authorization starts the trial', r.status === 200 && a?.subscriptionStatus === 'trial_active', { r, status: a?.subscriptionStatus });
    check('A: trial end = checkout snapshot (Razorpay start_at)', a?.trialEndsAt?.getTime() === trialEnd.getTime(), a?.trialEndsAt);
    const claimA = await db.collection('trialclaims').findOne({ phoneHash: 'hash_A' });
    check('A: phone claim consumed', claimA?.status === 'consumed', claimA?.status);
    const subA = await db.collection('subscriptions').findOne({ userId: userA });
    check('A: user entitlement is an offer trial', subA?.billingStatus === 'Trialing' && subA?.trialSource === 'offer' && subA?.trialStatus?.isActive === true, subA);

    r = await send('subscription.authenticated', { sub: trialEntity('sub_A', userA, wsA), createdAt: t, eventId: 'evt_auth_A' });
    check('A: duplicate webhook delivery is skipped', r.json?.skipped === 'duplicate event', r.json);

    let st = await (await get('/api/billing/status', userA, wsA)).json();
    check('A: /api/billing/status shows the workspace unlocked with trial dates', st?.workspace?.isActive === true && !!st?.workspace?.trial?.endsAt, st?.workspace);

    r = await send('subscription.activated', { sub: trialEntity('sub_A', userA, wsA, { status: 'active', paid_count: 0 }), createdAt: t + 60_000 });
    a = await biz(wsA);
    check('A: trial billing start (activated, paid_count 0) does NOT make it paid', a?.subscriptionStatus === 'trial_active', a?.subscriptionStatus);

    r = await send('subscription.pending', { sub: trialEntity('sub_A', userA, wsA, { status: 'pending' }), createdAt: t + 2 * 60_000 });
    a = await biz(wsA);
    check('A: failed first charge → past_due, Day 0 recorded', a?.subscriptionStatus === 'past_due' && !!a?.paymentFailedAt, { s: a?.subscriptionStatus, f: a?.paymentFailedAt });
    st = await (await get('/api/billing/status', userA, wsA)).json();
    check('A: access locked immediately after the confirmed failure', st?.workspace?.isActive === false, st?.workspace?.isActive);
    const failedAt = a?.paymentFailedAt?.getTime();
    await send('subscription.pending', { sub: trialEntity('sub_A', userA, wsA, { status: 'pending' }), createdAt: t + 3 * 60_000 });
    a = await biz(wsA);
    check('A: a retry failing again does not reset Day 0', a?.paymentFailedAt?.getTime() === failedAt);

    r = await send('subscription.charged', {
      sub: trialEntity('sub_A', userA, wsA, { status: 'active', paid_count: 1, current_end: Math.floor((trialEnd.getTime() + 365 * DAY) / 1000) }),
      payment: { id: 'pay_A', amount: 999_900, currency: 'INR', status: 'captured' },
      createdAt: t + 4 * 60_000,
    });
    a = await biz(wsA);
    check('A: verified charge for the snapshot amount → paid (recovery)', a?.subscriptionStatus === 'active' && !a?.paymentFailedAt, { s: a?.subscriptionStatus });
    check('A: paid-through date from Razorpay current_end', !!a?.subscriptionCurrentPeriodEnd);

    r = await send('subscription.pending', { sub: trialEntity('sub_A', userA, wsA, { status: 'pending' }), createdAt: t + 2.5 * 60_000 });
    a = await biz(wsA);
    check('A: a late, older failure event cannot undo the payment', a?.subscriptionStatus === 'active', a?.subscriptionStatus);

    // B: cancel during trial
    await send('subscription.authenticated', { sub: trialEntity('sub_B', userB, wsB), createdAt: t });
    r = await send('subscription.cancelled', { sub: trialEntity('sub_B', userB, wsB, { status: 'cancelled' }), createdAt: t + 60_000 });
    const b = await biz(wsB);
    check('B: cancelled trial keeps access until the ORIGINAL trial end', b?.subscriptionStatus === 'trial_active' && !!b?.trialCancelledAt && b?.trialEndsAt?.getTime() === trialEnd.getTime(), b);
    const subB = await db.collection('subscriptions').findOne({ userId: userB });
    check('B: user trial now ends exactly at the trial end (no processing window)', subB?.trialStatus?.endsAt?.getTime() === trialEnd.getTime(), subB?.trialStatus);
    const claimB = await db.collection('trialclaims').findOne({ phoneHash: 'hash_B' });
    check('B: the consumed claim stays consumed after cancelling', claimB?.status === 'consumed', claimB?.status);

    // C: normal paid (non-trial) checkout unchanged
    r = await send('subscription.activated', {
      sub: { id: 'sub_C', plan_id: 'plan_monthly', status: 'active', paid_count: 1, current_end: Math.floor((now + 30 * DAY) / 1000), notes: { userId: String(userC), businessId: String(wsC), planType: 'Pro', billingCycle: 'monthly', trial: '0' } },
      payment: { id: 'pay_C', amount: 499_900, currency: 'INR', status: 'captured' },
      createdAt: t,
    });
    const c = await biz(wsC);
    check('C: non-trial paid checkout activates as before', c?.subscriptionStatus === 'active', c?.subscriptionStatus);

    // D: declined checkout on a never-paid workspace
    r = await send('payment.failed', { payment: { id: 'pay_D', amount: 499_900, currency: 'INR', status: 'failed', notes: { userId: String(userD), businessId: String(wsD) } }, createdAt: t });
    const d = await biz(wsD);
    check('D: declined checkout does not mark the workspace past due', d?.subscriptionStatus === 'trialing' && !d?.paymentFailedAt, d?.subscriptionStatus);
    r = await send('subscription.expired', { sub: { id: 'sub_D', status: 'expired', paid_count: 0, notes: { userId: String(userD), businessId: String(wsD), planType: 'Pro', trial: '0' } }, createdAt: t });
    const d2 = await biz(wsD);
    check('D: expired unpaid checkout does not cancel the workspace', d2?.subscriptionStatus === 'trialing', d2?.subscriptionStatus);

    // E: wrong amount
    await send('subscription.authenticated', { sub: trialEntity('sub_E', userE, wsE), createdAt: t });
    await send('subscription.charged', { sub: trialEntity('sub_E', userE, wsE, { status: 'active', paid_count: 1 }), payment: { id: 'pay_E', amount: 100, currency: 'INR', status: 'captured' }, createdAt: t + 60_000 });
    const e = await biz(wsE);
    check('E: a charge for the wrong amount does not grant paid access', e?.subscriptionStatus === 'trial_active', e?.subscriptionStatus);

    // F: authorization for a subscription that owns no claim
    await send('subscription.authenticated', { sub: trialEntity('sub_F', userF, wsF), createdAt: t });
    const f = await biz(wsF);
    check('F: trial authorization without the phone claim is rejected', f?.subscriptionStatus === 'trialing', f?.subscriptionStatus);

    // Audit trail
    const events = await db.collection('billingevents').countDocuments({});
    check('every processed event is in the BillingEvent audit trail', events >= 12, events);

    // Offer switch + preview
    let offer = await (await get('/api/billing/trial-offer', userG, wsG)).json();
    check('offer OFF by default: no trial preview', offer?.success === true && offer.offer === null, offer);
    let adminRes = await put('/api/admin/billing-policy', userG, { trial: { offerEnabled: true, trialMonths: 3 } });
    check('a customer cannot change the billing policy', adminRes.status === 401 || adminRes.status === 403, adminRes.status);
    adminRes = await put('/api/admin/billing-policy', admin, { trial: { offerEnabled: true, trialMonths: 99 } }, 'SUPER_ADMIN');
    check('invalid policy is rejected (400)', adminRes.status === 400, adminRes.status);
    adminRes = await put('/api/admin/billing-policy', admin, { trial: { offerEnabled: true, trialMonths: 3 } }, 'SUPER_ADMIN');
    check('super admin switches the offer ON', adminRes.status === 200, await adminRes.text());
    const log = await db.collection('adminactionlogs').findOne({ action: 'billing_policy.update' });
    check('the change is audited with old and new values', log?.metadata?.old?.trial?.offerEnabled === false && log?.metadata?.new?.trial?.offerEnabled === true, log?.metadata);
    // Plans need an enabled yearly duration for a preview.
    await db.collection('billingplans').insertOne({
      key: 'default', displayName: 'GrowwMatics AI', priceInr: 4999, features: [], updatedBy: '',
      durations: [{ cycle: 'monthly', priceInr: 4999, enabled: true }, { cycle: 'yearly', priceInr: 9999, enabled: true }],
    });
    offer = await (await get('/api/billing/trial-offer', userG, wsG)).json();
    check('offer ON: an eligible verified customer sees the trial with server dates', offer?.offer?.eligible === true && !!offer?.offer?.preview?.trialEndsAt, offer);
    offer = await (await get('/api/billing/trial-offer', userA, wsA)).json();
    check('offer ON: a phone that already used its trial is not eligible', offer?.offer?.eligible === false, offer?.offer);
    const plans = await (await fetch(`${BASE}/api/billing/plans`)).json();
    check('public plans show the offer for display', plans?.plan?.trialOffer?.months === 3, plans?.plan?.trialOffer);
    await put('/api/admin/billing-policy', admin, { trial: { offerEnabled: false, trialMonths: 3 } }, 'SUPER_ADMIN');
    const bAfterOff = await biz(wsB);
    check('switching OFF does not touch an existing trial', bAfterOff?.subscriptionStatus === 'trial_active' && bAfterOff?.trialEndsAt?.getTime() === trialEnd.getTime());

    // ── Phase 3: entitlements per subscription state, web + mobile ──────────
    console.log('\n[check] access matrix (web cookie + mobile bearer)');
    const ALL_ON = Object.fromEntries(
      ['google_ranking_agent', 'reputation_agent', 'sales_agent', 'content_studio', 'marketing_automation'].map((k) => [k, { enabled: true, activatedAt: new Date() }])
    );
    const FREE_MODS = { google_ranking_agent: { enabled: true, activatedAt: new Date() } };
    const future = new Date(now + 40 * DAY);
    const longPast = new Date(now - 5 * DAY);
    let phoneSeq = 100;
    const mkState = async (label: string, ws: Record<string, unknown>, sub: Record<string, unknown>, userPlan = 'Free') => {
      const userId = await mkUser(`+9190000${String(phoneSeq++).padStart(5, '0')}`);
      await db.collection('users').updateOne({ _id: userId }, { $set: { subscriptionPlan: userPlan } });
      await db.collection('subscriptions').updateOne({ userId }, { $set: sub });
      const businessId = await mkBusiness(userId, label);
      await db.collection('businesses').updateOne({ _id: businessId }, { $set: { googleConnected: true, ...ws } });
      return { label, userId, businessId };
    };
    const states = [
      { s: await mkState('paid', { subscriptionStatus: 'active' }, { planType: 'Pro', billingStatus: 'Active', modules: ALL_ON }, 'Pro'), paid: true, plan: 'Pro' },
      { s: await mkState('trial', { subscriptionStatus: 'trial_active', trialEndsAt: future }, { billingStatus: 'Trialing', trialSource: 'offer', trialStatus: { isActive: true, endsAt: future }, modules: FREE_MODS }), paid: true, plan: 'Pro' },
      { s: await mkState('trial-cancelled-still-running', { subscriptionStatus: 'trial_active', trialEndsAt: future, trialCancelledAt: new Date() }, { billingStatus: 'Trialing', trialSource: 'offer', trialStatus: { isActive: true, endsAt: future }, modules: FREE_MODS }), paid: true, plan: 'Pro' },
      { s: await mkState('trial-expired', { subscriptionStatus: 'trial_active', trialEndsAt: longPast }, { billingStatus: 'Trialing', trialSource: 'offer', trialStatus: { isActive: true, endsAt: longPast }, modules: FREE_MODS }), paid: false, plan: 'Free' },
      { s: await mkState('past-due-after-paying', { subscriptionStatus: 'past_due', paymentFailedAt: new Date() }, { planType: 'Pro', billingStatus: 'PastDue', modules: ALL_ON }, 'Pro'), paid: false, plan: 'Pro' },
      { s: await mkState('legacy-14-day-default', { subscriptionStatus: 'trialing' }, { billingStatus: 'Trialing', trialStatus: { isActive: true, endsAt: future }, modules: FREE_MODS }), paid: false, plan: 'Free' },
      { s: await mkState('cancelled', { subscriptionStatus: 'canceled' }, { planType: 'Free', billingStatus: 'Canceled', modules: FREE_MODS }), paid: false, plan: 'Free' },
      { s: await mkState('free', { subscriptionStatus: 'trialing' }, { planType: 'Free', billingStatus: 'Active', modules: FREE_MODS }), paid: false, plan: 'Free' },
    ];
    const bearerGet = async (p: string, userId: any, businessId: any) =>
      fetch(`${BASE}${p}`, { headers: { authorization: `Bearer ${await token(userId)}`, 'x-business-id': String(businessId), 'x-client': 'mobile' } });

    for (const { s: st, paid, plan } of states) {
      const web = await get('/api/crm/leads', st.userId, st.businessId);
      const mobile = await bearerGet('/api/crm/leads', st.userId, st.businessId);
      check(`${st.label}: paid-module API (web) ${paid ? 'open' : 'locked'}`, web.status === (paid ? 200 : 403), web.status);
      check(`${st.label}: paid-module API (mobile) ${paid ? 'open' : 'locked'}`, mobile.status === (paid ? 200 : 403), mobile.status);
      const status = await (await bearerGet('/api/billing/status', st.userId, st.businessId)).json();
      check(`${st.label}: workspace ${paid ? 'unlocked' : 'locked'}`, status?.workspace?.isActive === paid, status?.workspace?.isActive);
      const usage = await (await get('/api/user/usage', st.userId, st.businessId)).json();
      const usagePlan = usage?.plan ?? usage?.data?.plan;
      check(`${st.label}: usage limits plan = ${plan}`, usagePlan === plan, usagePlan);
      const autopilot = await (await get('/api/content/autopilot-status', st.userId, st.businessId)).json();
      const qualified = autopilot?.qualified ?? autopilot?.data?.qualified;
      check(`${st.label}: weekly content autopilot ${paid ? 'qualified' : 'not qualified'}`, qualified === paid, qualified);
      const weekly = await (await get('/api/content/weekly-offer', st.userId, st.businessId)).json();
      check(`${st.label}: weekly offer ${paid ? 'asked' : 'not asked'}`, weekly?.eligible === paid, weekly?.eligible);
    }
    const me = await (await bearerGet('/api/auth/me', states[1].s.userId, states[1].s.businessId)).json();
    check('mobile /api/auth/me exposes trialSource for the app\'s entitlement mirror', me?.user?.subscription?.trialSource === 'offer', me?.user?.subscription);
    const meLegacy = await (await bearerGet('/api/auth/me', states[5].s.userId, states[5].s.businessId)).json();
    check('legacy default "Trialing" record has no trialSource', meLegacy?.user?.subscription?.trialSource === null, meLegacy?.user?.subscription);

    // ── Tenant isolation ──
    console.log('\n[check] tenant isolation');
    const paidUser = states[0].s;
    const otherWs = states[1].s.businessId;
    let res = await bearerGet('/api/crm/leads', paidUser.userId, otherWs);
    check('another workspace\'s CRM: refused', res.status === 403, res.status);
    res = await bearerGet('/api/billing/status', paidUser.userId, otherWs);
    const leak = await res.json();
    check('another workspace\'s billing status: not revealed', res.status === 200 && leak?.workspace === null, leak?.workspace);
    res = await bearerGet('/api/billing/trial-offer', paidUser.userId, otherWs);
    check('another workspace\'s trial offer: refused', res.status === 403, res.status);
    res = await bearerGet('/api/content/autopilot-status', paidUser.userId, otherWs);
    check('another workspace\'s autopilot status: refused', res.status === 403, res.status);
    res = await fetch(`${BASE}/api/crm/leads`, { headers: { 'x-business-id': String(otherWs) } });
    check('no session: refused', res.status === 401 || res.status === 403, res.status);

    // ── Free Report still works and never creates a trial ──
    console.log('\n[check] free report');
    const fr = await fetch(`${BASE}/api/free-report/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.8.7' },
      body: JSON.stringify({ phone: '+919000000777', businessName: 'Free Report Check Cafe', city: 'Pune', state: 'Maharashtra', country: 'India' }),
    });
    const frUser = await db.collection('users').findOne({ phone: '+919000000777' });
    const frSub = frUser ? await db.collection('subscriptions').findOne({ userId: frUser._id }) : null;
    const frWs = frUser ? await db.collection('businesses').findOne({ userId: frUser._id }) : null;
    await new Promise((r) => setTimeout(r, 500));
    const frErrors = serverLog.join('').split(/\r?\n/).filter((l) => /free.?report|inngest/i.test(l) && /error|fail/i.test(l)).slice(-3);
    console.log(`        (free-report/start answered ${fr.status}${frErrors.length ? `; server said: ${frErrors.join(' | ').slice(0, 300)}` : ''})`);
    check('free report succeeds (201 Created) with a valid (local) Inngest config', fr.status === 201, fr.status);
    check('free report dispatched the audit job', inngestEvents.some((e) => e?.name === 'audit/generate.requested'), inngestEvents.map((e) => e?.name));
    check('free report creates the shadow account and its workspace', !!frUser && !!frWs, { user: !!frUser, ws: !!frWs });
    check('free report workspace is never-paid, not a trial', frWs?.subscriptionStatus === 'trialing' && !frWs?.trialEndsAt, frWs?.subscriptionStatus);
    check('free report subscription is a plain free one (no 14-day default)', frSub?.billingStatus === 'Active' && frSub?.trialStatus?.isActive === false && !frSub?.trialSource, frSub);

    // ── Phase 4: failed-payment policy ───────────────────────────────────────
    console.log('\n[check] failed-payment policy');
    {
    const ADMIN = 'SUPER_ADMIN';
    const putPolicy = async (body: unknown, as: any = admin, role = ADMIN) => put('/api/admin/billing-policy', as, body, role);
    const DEFAULT_FAILURE = { firstCharge: { mode: 'immediate' }, renewal: { mode: 'grace', graceDays: 3 }, restrictedModules: ['reputation_agent', 'sales_agent', 'content_studio', 'marketing_automation'], restoreAccessOnRecovery: true };
    const pol = await (await get('/api/admin/billing-policy', admin, undefined, ADMIN)).json();
    check('defaults: trial-end failure immediate, renewal 3-day grace', pol?.failure?.firstCharge?.mode === 'immediate' && pol?.failure?.renewal?.graceDays === 3, pol?.failure);
    check('login, free report, billing, recovery, support listed as always accessible', JSON.stringify(pol?.alwaysAccessible) === JSON.stringify(['login', 'free_report', 'billing', 'payment_recovery', 'support']), pol?.alwaysAccessible);

    let paidSeq = 0;
    const mkPaid = async (label: string) => {
      const st = await mkState(label, { subscriptionStatus: 'active' }, { planType: 'Pro', billingStatus: 'Active', modules: ALL_ON }, 'Pro');
      const subId = `sub_paid_${++paidSeq}`;
      await db.collection('businesses').updateOne({ _id: st.businessId }, { $set: { billingSubscriptionId: subId, razorpaySubscriptionId: subId, subscriptionCurrentPeriodEnd: new Date(now + 2 * DAY) } });
      return { ...st, subId };
    };
    const paidEntity = (p: { subId: string; userId: any; businessId: any }, status: string, over: Record<string, unknown> = {}) => ({
      id: p.subId, entity: 'subscription', plan_id: 'plan_monthly', status, paid_count: 3, current_end: Math.floor((now + 32 * DAY) / 1000),
      notes: { userId: String(p.userId), businessId: String(p.businessId), planType: 'Pro', billingCycle: 'monthly', trial: '0' }, ...over,
    });
    const charge = (p: any, createdAt: number) => send('subscription.charged', { sub: paidEntity(p, 'active'), payment: { id: `pay_${p.subId}_${createdAt}`, amount: 499_900, currency: 'INR', status: 'captured' }, createdAt });
    const fail = (p: any, createdAt: number) => send('subscription.pending', { sub: paidEntity(p, 'pending'), createdAt });
    const api = async (p: any, path = '/api/crm/leads') => ({ web: (await get(path, p.userId, p.businessId)).status, mobile: (await bearerGet(path, p.userId, p.businessId)).status });
    const access = async (p: any) => (await (await bearerGet('/api/billing/status', p.userId, p.businessId)).json())?.workspace;
    const expire = async (p: any) => {
      const past = new Date(Date.now() - 60_000);
      await db.collection('businesses').updateOne({ _id: p.businessId }, { $set: { paymentGraceEndsAt: past } });
      await db.collection('subscriptions').updateOne({ userId: p.userId }, { $set: { paymentGraceEndsAt: past } });
    };
    const T = now - 30 * 60_000;

    // R: renewal failure with the default 3-day grace
    const R = await mkPaid('renewal-grace');
    await fail(R, T);
    let rb = await biz(R.businessId);
    const graceMs = rb?.paymentGraceEndsAt && rb?.paymentFailedAt ? rb.paymentGraceEndsAt.getTime() - rb.paymentFailedAt.getTime() : -1;
    check('R: renewal failure → past_due (never active), kind renewal, grace = 3 days', rb?.subscriptionStatus === 'past_due' && rb?.paymentFailureKind === 'renewal' && graceMs === 3 * DAY, { s: rb?.subscriptionStatus, k: rb?.paymentFailureKind, graceMs });
    let r = await api(R);
    check('R: during grace the paid modules stay open (web + mobile)', r.web === 200 && r.mobile === 200, r);
    let w = await access(R);
    check('R: during grace the workspace is unlocked, mode "grace"', w?.isActive === true && w?.access?.mode === 'grace' && w?.subscriptionStatus === 'past_due', w);
    const meR = await (await bearerGet('/api/auth/me', R.userId, R.businessId)).json();
    check('R: mobile sees the grace end', !!meR?.user?.subscription?.paymentGraceEndsAt, meR?.user?.subscription);
    const autoR = await (await get('/api/content/autopilot-status', R.userId, R.businessId)).json();
    check('R: automations continue during grace', (autoR?.qualified ?? autoR?.data?.qualified) === true, autoR);
    const graceBefore = rb?.paymentGraceEndsAt?.getTime();
    const res4 = await putPolicy({ failure: { ...DEFAULT_FAILURE, renewal: { mode: 'grace', graceDays: 10 } } });
    rb = await biz(R.businessId);
    check('R: admin changing the grace mid-episode does not move this failure', res4.status === 200 && rb?.paymentGraceEndsAt?.getTime() === graceBefore, { status: res4.status });
    await putPolicy({ failure: DEFAULT_FAILURE });
    await fail(R, T + 60_000);
    rb = await biz(R.businessId);
    check('R: a duplicate failure event keeps Day 0 and the grace end', rb?.paymentGraceEndsAt?.getTime() === graceBefore);
    await expire(R);
    r = await api(R);
    check('R: after grace the paid modules are locked (web + mobile)', r.web === 403 && r.mobile === 403, r);
    w = await access(R);
    check('R: after grace the workspace is restricted', w?.isActive === false && w?.access?.mode === 'restricted', w?.access);
    const autoR2 = await (await get('/api/content/autopilot-status', R.userId, R.businessId)).json();
    check('R: automations stop after grace', (autoR2?.qualified ?? autoR2?.data?.qualified) === false, autoR2);
    const meStatus = (await bearerGet('/api/auth/me', R.userId, R.businessId)).status;
    const billingPage = (await get('/dashboard/billing', R.userId, R.businessId)).status;
    const auditPage = (await get('/dashboard/audit', R.userId, R.businessId)).status;
    const freeModule = await api(R, '/api/gbp/insights');
    check('R: login/session, billing page, free audit page still reachable while restricted', meStatus === 200 && billingPage === 200 && auditPage === 200, { meStatus, billingPage, auditPage });
    check('R: the always-free module is not blocked by billing', freeModule.web !== 403 && freeModule.mobile !== 403, freeModule);
    await charge(R, T + 5 * 60_000);
    rb = await biz(R.businessId);
    r = await api(R);
    check('R: verified recovery after restriction → active, access back, failure cleared', rb?.subscriptionStatus === 'active' && !rb?.paymentGraceEndsAt && r.web === 200 && r.mobile === 200, { s: rb?.subscriptionStatus, r });
    await fail(R, T + 2 * 60_000);
    rb = await biz(R.businessId);
    check('R: an older failure arriving late cannot lock it again', rb?.subscriptionStatus === 'active', rb?.subscriptionStatus);

    // G: recovery during grace
    const G = await mkPaid('recovers-in-grace');
    await fail(G, T);
    await charge(G, T + 60_000);
    const gb = await biz(G.businessId);
    r = await api(G);
    check('G: recovery during grace → active, no interruption', gb?.subscriptionStatus === 'active' && r.web === 200 && r.mobile === 200, { s: gb?.subscriptionStatus, r });

    // F1: failed first charge after a free trial → immediate
    const userT = await mkUser('+919000000501');
    const wsT = await mkBusiness(userT, 'Trial First Charge Fails');
    await mkClaim(userT, wsT, 'sub_T1', 'hash_T1');
    await send('subscription.authenticated', { sub: trialEntity('sub_T1', userT, wsT), createdAt: T });
    await send('subscription.pending', { sub: trialEntity('sub_T1', userT, wsT, { status: 'pending' }), createdAt: T + 60_000 });
    const tb = await biz(wsT);
    r = { web: (await get('/api/crm/leads', userT, wsT)).status, mobile: (await bearerGet('/api/crm/leads', userT, wsT)).status };
    check('F1: trial first-charge failure → kind first_charge, no grace', tb?.paymentFailureKind === 'first_charge' && tb?.paymentGraceEndsAt?.getTime() === tb?.paymentFailedAt?.getTime(), tb);
    check('F1: paid access restricted immediately (web + mobile)', r.web === 403 && r.mobile === 403, r);

    // P: restricted vs unrestricted capabilities
    await putPolicy({ failure: { firstCharge: { mode: 'immediate' }, renewal: { mode: 'immediate' }, restrictedModules: ['content_studio'], restoreAccessOnRecovery: true } });
    const P = await mkPaid('partial-restriction');
    await fail(P, T);
    const sales = await api(P);
    const content = await api(P, '/api/content/posts');
    check('P: unrestricted module (CRM) stays open', sales.web === 200 && sales.mobile === 200, sales);
    check('P: restricted module (content) is locked', content.web === 403 && content.mobile === 403, content);
    w = await access(P);
    check('P: dashboard told to lock only content pages', w?.access?.mode === 'restricted' && JSON.stringify(w?.access?.restrictedModules) === '["content_studio"]', w?.access);
    const meP = await (await bearerGet('/api/auth/me', P.userId, P.businessId)).json();
    check('P: mobile gets the same restricted list', JSON.stringify(meP?.user?.subscription?.restrictedModules) === '["content_studio"]', meP?.user?.subscription);

    // H: recovery held for review
    await putPolicy({ failure: { ...DEFAULT_FAILURE, renewal: { mode: 'immediate' }, restoreAccessOnRecovery: false } });
    const Hh = await mkPaid('held-recovery');
    await fail(Hh, T);
    await charge(Hh, T + 60_000);
    w = await access(Hh);
    r = await api(Hh);
    check('H: paid again but held → status active, access held, modules locked', w?.subscriptionStatus === 'active' && w?.access?.mode === 'held' && w?.isActive === false && r.web === 403 && r.mobile === 403, { w: w?.access, r });
    let rel = await fetch(`${BASE}/api/admin/billing/release-hold`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `session=${await token(Hh.userId)}` }, body: JSON.stringify({ businessId: String(Hh.businessId) }) });
    check('H: a customer cannot release a hold', rel.status === 401 || rel.status === 403, rel.status);
    rel = await fetch(`${BASE}/api/admin/billing/release-hold`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `session=${await token(admin, ADMIN)}` }, body: JSON.stringify({ businessId: String(Hh.businessId) }) });
    r = await api(Hh);
    const relLog = await db.collection('adminactionlogs').findOne({ action: 'billing.release_hold', targetBusinessId: Hh.businessId });
    check('H: super admin releases it → access back, audited', rel.status === 200 && r.web === 200 && r.mobile === 200 && !!relLog, { status: rel.status, r, log: !!relLog });
    rel = await fetch(`${BASE}/api/admin/billing/release-hold`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `session=${await token(admin, ADMIN)}` }, body: JSON.stringify({ businessId: String(R.businessId) }) });
    check('H: release only works on a held, paid workspace', rel.status === 404, rel.status);

    // Admin authorization, validation, audit
    let pr = await putPolicy({ failure: DEFAULT_FAILURE }, R.userId, 'CLIENT');
    check('policy: a customer cannot change the failed-payment policy', pr.status === 401 || pr.status === 403, pr.status);
    for (const [label, bad] of [
      ['grace 99 days', { ...DEFAULT_FAILURE, renewal: { mode: 'grace', graceDays: 99 } }],
      ['restricting the free module', { ...DEFAULT_FAILURE, restrictedModules: ['google_ranking_agent'] }],
      ['turning billing access off', { ...DEFAULT_FAILURE, alwaysAccessible: { login: true, free_report: true, billing: false, payment_recovery: true, support: true } }],
    ] as const) {
      pr = await putPolicy({ failure: bad });
      check(`policy: rejects ${label} (400)`, pr.status === 400, pr.status);
    }
    pr = await putPolicy({ failure: DEFAULT_FAILURE });
    const failureLog = await db.collection('adminactionlogs').find({ action: 'billing_policy.update' }).sort({ _id: -1 }).limit(1).next();
    check('policy: change audited with old and new failure policy', pr.status === 200 && failureLog?.metadata?.old?.failure?.restoreAccessOnRecovery === false && failureLog?.metadata?.new?.failure?.restoreAccessOnRecovery === true, failureLog?.metadata);

    // Malformed stored config → agreed defaults, never more access
    await db.collection('billingpolicies').updateOne({ key: 'default' }, { $set: { failure: { renewal: 'garbage', restrictedModules: 'all', restoreAccessOnRecovery: 'maybe' } } });
    const polBad = await (await get('/api/admin/billing-policy', admin, undefined, ADMIN)).json();
    check('malformed config is read as the defaults', polBad?.failure?.renewal?.graceDays === 3 && polBad?.failure?.restrictedModules?.length === 4 && polBad?.failure?.restoreAccessOnRecovery === true, polBad?.failure);
    const M = await mkPaid('malformed-config');
    await fail(M, T);
    const mb = await biz(M.businessId);
    check('malformed config: a new failure gets the default 3-day grace', mb?.paymentGraceEndsAt && mb?.paymentFailedAt && mb.paymentGraceEndsAt.getTime() - mb.paymentFailedAt.getTime() === 3 * DAY, mb);
    await putPolicy({ failure: DEFAULT_FAILURE });

    // ── Phase 5: recovery reminders + safe recovery wiring ──────────────────
    console.log('\n[check] payment-recovery reminders and safe recovery');
    const SID = 'HX' + 'c'.repeat(32);
    const REMINDERS = {
      enabled: true, steps: [{ offsetDays: 0 }, { offsetDays: 1 }, { offsetDays: 2 }, { offsetDays: 7 }], maxReminders: 4,
      sendingHours: { start: 9, end: 20 }, timezone: 'Asia/Kolkata', retry: { maxAttempts: 3, backoffMinutes: 30 },
      template: { contentSid: SID, approved: true }, finalTemplate: null,
    };
    const pol5 = await (await get('/api/admin/billing-policy', admin, undefined, ADMIN)).json();
    check('reminders OFF by default (nothing sends until an admin enables them)', pol5?.reminders?.enabled === false && JSON.stringify(pol5?.reminders?.steps?.map((x: any) => x.offsetDays)) === '[0,1,2,7]', pol5?.reminders);

    // Reminders still off → a new failure opens an episode, but nothing is queued to send.
    const E0 = await mkPaid('episode-reminders-off');
    const evBefore = inngestEvents.length;
    await fail(E0, T);
    let ep0 = await db.collection('billingrecoveryepisodes').findOne({ businessId: E0.businessId });
    check('a new failure opens its recovery episode (Day 0 = the failure time)', !!ep0 && ep0.status === 'open' && ep0.steps?.length === 4 && ep0.failedAt?.getTime() === (await biz(E0.businessId))?.paymentFailedAt?.getTime(), ep0 && { status: ep0.status, steps: ep0.steps?.length });
    check('with reminders off, no reminder job is triggered', !inngestEvents.slice(evBefore).some((e) => e?.name === 'billing/recovery.process'));
    await fail(E0, T + 60_000);
    const episodesE0 = await db.collection('billingrecoveryepisodes').countDocuments({ businessId: E0.businessId });
    check('a retry failing again does not open a second episode or reset Day 0', episodesE0 === 1);

    // Admin configuration: authorization, validation, audit.
    let rp5 = await putPolicy({ reminders: REMINDERS }, E0.userId, 'CLIENT');
    check('reminders: a customer cannot change them', rp5.status === 401 || rp5.status === 403, rp5.status);
    for (const [label, bad] of [
      ['enabling without an approved template', { ...REMINDERS, template: { contentSid: SID, approved: false } }],
      ['a malformed template SID', { ...REMINDERS, template: { contentSid: 'HX123', approved: true } }],
      ['duplicate days', { ...REMINDERS, steps: [{ offsetDays: 1 }, { offsetDays: 1 }] }],
      ['an invalid timezone', { ...REMINDERS, timezone: 'Mars/Olympus' }],
      ['an empty sending window', { ...REMINDERS, sendingHours: { start: 20, end: 9 } }],
    ] as const) {
      rp5 = await putPolicy({ reminders: bad });
      check(`reminders: rejects ${label} (400)`, rp5.status === 400, rp5.status);
    }
    rp5 = await putPolicy({ reminders: { ...REMINDERS, steps: [{ offsetDays: 7 }, { offsetDays: 0 }, { offsetDays: 2 }, { offsetDays: 1 }] } });
    const remLog = await db.collection('adminactionlogs').find({ action: 'billing_policy.update' }).sort({ _id: -1 }).limit(1).next();
    check('reminders: enabled with an approved template, order normalised, audited old → new', rp5.status === 200 && remLog?.metadata?.old?.reminders?.enabled === false && remLog?.metadata?.new?.reminders?.enabled === true && JSON.stringify(remLog?.metadata?.new?.reminders?.steps?.map((x: any) => x.offsetDays)) === '[0,1,2,7]', remLog?.metadata?.new?.reminders);

    const E1 = await mkPaid('episode-reminders-on');
    const evBefore1 = inngestEvents.length;
    await fail(E1, T);
    check('with reminders on, Day 0 is queued right away (Inngest event)', inngestEvents.slice(evBefore1).some((e) => e?.name === 'billing/recovery.process'), inngestEvents.slice(evBefore1).map((e) => e?.name));

    // Stop conditions, through the real webhook.
    await charge(E1, T + 60_000);
    const ep1 = await db.collection('billingrecoveryepisodes').findOne({ businessId: E1.businessId });
    check('verified payment resolves the episode and stops its reminders', ep1?.status === 'resolved' && ep1?.stopReason === 'payment_recovered' && ep1?.steps.every((x: any) => x.status === 'stopped'), ep1 && { status: ep1.status, reason: ep1.stopReason });
    const E2 = await mkPaid('episode-cancelled');
    await fail(E2, T);
    await send('subscription.cancelled', { sub: paidEntity(E2, 'cancelled'), createdAt: T + 60_000 });
    const ep2 = await db.collection('billingrecoveryepisodes').findOne({ businessId: E2.businessId });
    check('cancellation stops the episode', ep2?.status === 'stopped' && ep2?.stopReason === 'subscription_cancelled', ep2 && { status: ep2.status, reason: ep2.stopReason });

    // Safe recovery: a superseded original's cancellation can't cancel the workspace.
    const E3 = await mkPaid('superseded-original');
    await fail(E3, T);
    await db.collection('businesses').updateOne({ _id: E3.businessId }, { $set: { supersededSubscriptionIds: [E3.subId] } });
    await send('subscription.cancelled', { sub: paidEntity(E3, 'cancelled'), createdAt: T + 60_000 });
    await send('subscription.halted', { sub: paidEntity(E3, 'halted'), createdAt: T + 120_000 });
    const b3 = await biz(E3.businessId);
    check('recovery: cancelling the replaced original does not cancel the workspace', b3?.subscriptionStatus === 'past_due', b3?.subscriptionStatus);
    // The replacement is paid → access back, reminders stop.
    const replacement = { ...E3, subId: 'sub_replacement_E3' };
    await charge(replacement, T + 5 * 60_000);
    const b3b = await biz(E3.businessId);
    const ep3 = await db.collection('billingrecoveryepisodes').findOne({ businessId: E3.businessId });
    r = await api(E3);
    check('recovery: the replacement payment restores access and becomes the billing subscription', b3b?.subscriptionStatus === 'active' && b3b?.billingSubscriptionId === 'sub_replacement_E3' && r.web === 200 && r.mobile === 200, { s: b3b?.subscriptionStatus, sub: b3b?.billingSubscriptionId, r });
    check('recovery: reminders stopped once recovered', ep3?.status === 'resolved', ep3?.status);
    await fail(E3, T + 2 * 60_000);
    check('recovery: a late failure of the old subscription cannot undo it', (await biz(E3.businessId))?.subscriptionStatus === 'active');

    // Checkout guards that need no Razorpay.
    const C1 = await mkPaid('already-subscribed');
    const co = await fetch(`${BASE}/api/billing/checkout`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `session=${await token(C1.userId)}; activeBusinessId=${C1.businessId}` }, body: JSON.stringify({ cycle: 'monthly' }) });
    const coJson = await co.json();
    check('checkout: a paid workspace cannot open a second subscription', co.status === 409 && coJson?.code === 'ALREADY_SUBSCRIBED', { status: co.status, code: coJson?.code });

    // Delivery status from Twilio's callback (sent ≠ delivered).
    await db.collection('billingrecoveryepisodes').updateOne({ businessId: E0.businessId }, { $set: { 'steps.0.status': 'sent', 'steps.0.attempts': 1, 'steps.0.providerMessageId': 'SMharness1', 'steps.0.sentAt': new Date() } });
    const cb = await fetch(`${BASE}/api/webhook/twilio/status`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ MessageSid: 'SMharness1', MessageStatus: 'delivered' }).toString() });
    ep0 = await db.collection('billingrecoveryepisodes').findOne({ businessId: E0.businessId });
    check('delivery comes only from the provider callback', cb.status === 200 && ep0?.steps?.[0]?.deliveryStatus === 'delivered', { status: cb.status, delivery: ep0?.steps?.[0]?.deliveryStatus });

    // Operator visibility.
    await db.collection('billingevents').insertOne({ businessId: E0.businessId, eventType: 'recovery.blocked', source: 'recovery', eventAt: new Date(), actions: [], note: 'razorpay_unreachable: harness', needsReview: true, createdAt: new Date() });
    let mon = await get('/api/admin/billing/recovery', E0.userId, E0.businessId);
    check('monitoring: customers cannot see it', mon.status === 401 || mon.status === 403, mon.status);
    mon = await get('/api/admin/billing/recovery', admin, undefined, ADMIN);
    const monJson = await mon.json();
    const openE0 = monJson?.episodes?.find((x: any) => x.businessId === String(E0.businessId));
    check('monitoring: open episode with next reminder and last attempt + delivery', !!openE0 && openE0.remindersSent >= 0 && openE0.lastAttempt?.deliveryStatus === 'delivered' && !!openE0.nextReminder, openE0);
    const blocked = monJson?.needsReview?.billingOperations?.find((x: any) => x.type === 'recovery.blocked');
    check('monitoring: failed/ambiguous Razorpay recovery operations are listed for review', !!blocked, monJson?.needsReview);
    const reviewed = await fetch(`${BASE}/api/admin/billing/recovery`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `session=${await token(admin, ADMIN)}` }, body: JSON.stringify({ kind: 'billingEvent', id: blocked?.id, note: 'checked' }) });
    const reviewLog = await db.collection('adminactionlogs').findOne({ action: 'billing.review.billingEvent' });
    check('monitoring: marking reviewed is audited', reviewed.status === 200 && !!reviewLog, reviewed.status);
    const holdEvent = await db.collection('billingevents').findOne({ eventType: 'admin.release_hold' });
    check('release-hold is in the billing audit history too', !!holdEvent && holdEvent.source === 'admin');

    // Leave reminders off.
    await putPolicy({ reminders: { ...REMINDERS, enabled: false } });

    // ── Phase 6: super-admin billing UI + monitoring ───────────────────────
    console.log('\n[check] super-admin billing dashboard and monitoring');
    const pageAdmin = await fetch(`${BASE}/admin/billing`, { headers: { cookie: `session=${await token(admin, ADMIN)}` }, redirect: 'manual' });
    const pageHtml = pageAdmin.status === 200 ? await pageAdmin.text() : '';
    check('dashboard: /admin/billing renders for a super admin', pageAdmin.status === 200 && /<html/i.test(pageHtml), pageAdmin.status);
    const pageCustomer = await fetch(`${BASE}/admin/billing`, { headers: { cookie: `session=${await token(R.userId)}` }, redirect: 'manual' });
    check('dashboard: a customer is sent to the admin login', [302, 303, 307, 308].includes(pageCustomer.status) && /admin-login/.test(pageCustomer.headers.get('location') ?? ''), { status: pageCustomer.status, to: pageCustomer.headers.get('location') });

    const adminGet = async (path: string) => (await get(path, admin, undefined, ADMIN)).json();
    const listRes = await get('/api/admin/billing/subscriptions', R.userId, R.businessId);
    check('monitoring list: customers refused', listRes.status === 401 || listRes.status === 403, listRes.status);
    const all = await adminGet('/api/admin/billing/subscriptions?limit=100');
    check('monitoring list: rows and per-status counts', all?.success === true && all.rows.length > 0 && typeof all.counts?.paid === 'number', all?.counts);
    const restricted = await adminGet('/api/admin/billing/subscriptions?status=past_due_restricted&limit=100');
    check('monitoring list: status filter returns only that status', restricted.rows.length > 0 && restricted.rows.every((x: any) => x.status === 'past_due_restricted'), restricted.rows.map((x: any) => x.status));
    const heldList = await adminGet('/api/admin/billing/subscriptions?status=held');
    const searched = await adminGet('/api/admin/billing/subscriptions?q=partial-restriction');
    check('monitoring list: search by workspace name', searched.rows.length === 1 && searched.rows[0].workspace === 'partial-restriction', searched.rows.map((x: any) => x.workspace));
    const byId = await adminGet(`/api/admin/billing/subscriptions?q=${encodeURIComponent(P.subId)}`);
    check('monitoring list: search by Razorpay subscription id', byId.rows.length === 1 && byId.rows[0].razorpaySubscriptionId === P.subId, byId.rows.length);
    const pRow = searched.rows[0];
    check('monitoring row: failure, grace/restriction and reminder fields', pRow?.payment?.failedAt && JSON.stringify(pRow?.payment?.restrictedModules) === '["content_studio"]' && pRow?.reminders !== undefined, pRow?.payment);
    check('monitoring list: held filter', Array.isArray(heldList.rows), heldList.rows?.length);

    const detail = await adminGet(`/api/admin/billing/subscriptions/${R.businessId}?verify=1`);
    check('detail: billing history, reminder episodes and admin actions', detail?.success && detail.events.length > 0 && Array.isArray(detail.episodes) && Array.isArray(detail.adminActions), { events: detail?.events?.length });
    check('detail: live Razorpay check reports unavailable here (no keys) — never guesses', detail?.razorpay?.available === false, detail?.razorpay);
    const detailCustomer = await get(`/api/admin/billing/subscriptions/${R.businessId}`, P.userId, P.businessId);
    check('detail: another customer cannot read it', detailCustomer.status === 401 || detailCustomer.status === 403, detailCustomer.status);

    // Redaction across everything the dashboard reads.
    const recoveryView = await adminGet('/api/admin/billing/recovery');
    const policyView = await adminGet('/api/admin/billing-policy');
    const dump = JSON.stringify([all, restricted, searched, detail, recoveryView, policyView]);
    // Customer contact data must be masked. (The acting super admin's own email
    // is shown on purpose — "last changed by" and the admin-action history.)
    const customers = await db.collection('users').find({ role: { $ne: 'SUPER_ADMIN' } }).project({ phone: 1, email: 1 }).toArray();
    const leaked = customers.filter((u: any) => (u.phone && dump.includes(String(u.phone).replace('+', ''))) || (u.email && dump.includes(u.email)));
    check('redaction: no customer phone number or email in any admin billing response', customers.length > 10 && leaked.length === 0, leaked.slice(0, 3));
    check('redaction: no secrets or credential fields', ![WEBHOOK_SECRET, SESSION_SECRET, 'passwordHash', 'phoneOtpHash', 'cvv', 'card_number'].some((x) => dump.includes(x)));

    // Review queue: new categories, review never changes state.
    await db.collection('trialclaims').insertOne({
      phoneHash: 'hash_stuck', status: 'reserved', userId: oid(), businessId: R.businessId, holderBusinessId: oid(), razorpaySubscriptionId: 'sub_stuck',
      reservedAt: new Date(now - 2 * DAY), reservedUntil: new Date(now - DAY), needsReview: false, history: [], createdAt: new Date(), updatedAt: new Date(),
    });
    const doubt = await db.collection('trialclaims').insertOne({
      phoneHash: 'hash_doubt', status: 'reserved', userId: oid(), businessId: R.businessId, holderBusinessId: oid(), razorpaySubscriptionId: 'sub_doubt',
      reservedAt: new Date(now - 2 * DAY), reservedUntil: new Date(now - DAY), needsReview: true, history: [], createdAt: new Date(), updatedAt: new Date(),
    });
    const amb = await db.collection('billingrecoveryepisodes').insertOne({
      businessId: oid(), userId: oid(), failedAt: new Date(), status: 'stopped', stopReason: 'payment_recovered', remindersSent: 0, needsReview: true,
      steps: [{ key: 'd0', offsetDays: 0, final: false, dueAt: new Date(), nextAttemptAt: new Date(), status: 'ambiguous', attempts: 1, claimedAt: new Date(), lastError: 'Request timed out' }],
      createdAt: new Date(), updatedAt: new Date(),
    });
    const X = await mkPaid('expired-recovery-checkout');
    await fail(X, T);
    await db.collection('businesses').updateOne({ _id: X.businessId }, { $set: { recoveryCheckout: { subscriptionId: 'sub_rc_old', cycle: 'monthly', createdAt: new Date(now - 2 * DAY), expiresAt: new Date(now - DAY) } } });
    const queue = (await adminGet('/api/admin/billing/recovery')).needsReview;
    check('queue: stuck trial reservations listed', queue.stuckTrialReservations.some((c: any) => c.subscriptionId === 'sub_stuck'), queue.stuckTrialReservations);
    check('queue: ambiguous WhatsApp sends listed with the reason', queue.ambiguousSends.some((x: any) => x.episodeId === String(amb.insertedId) && /timed out/.test(x.reason)), queue.ambiguousSends);
    check('queue: expired recovery checkouts listed', queue.expiredRecoveryCheckouts.some((x: any) => x.subscriptionId === 'sub_rc_old'), queue.expiredRecoveryCheckouts);
    check('queue: trial claims in doubt listed', queue.trialClaims.some((c: any) => c.id === String(doubt.insertedId)), queue.trialClaims);
    const reviewPost = async (body: unknown, as: any, role = ADMIN) =>
      fetch(`${BASE}/api/admin/billing/recovery`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `session=${await token(as, role)}` }, body: JSON.stringify(body) });
    let rv = await reviewPost({ kind: 'trialClaim', id: String(doubt.insertedId), note: 'checked in Razorpay' }, R.userId, 'CLIENT');
    check('review: customers refused', rv.status === 401 || rv.status === 403, rv.status);
    rv = await reviewPost({ kind: 'trialClaim', id: String(doubt.insertedId), note: 'checked in Razorpay' }, admin);
    const claimAfter = await db.collection('trialclaims').findOne({ _id: doubt.insertedId });
    const claimLog = await db.collection('adminactionlogs').findOne({ action: 'billing.review.trialClaim' });
    check('review: trial claim — only the flag changes (still reserved), audited old → new', rv.status === 200 && claimAfter?.status === 'reserved' && claimAfter?.needsReview === false && claimLog?.metadata?.old?.needsReview === true && claimLog?.metadata?.new?.needsReview === false, { status: claimAfter?.status, meta: claimLog?.metadata });
    const sendsBefore = inngestEvents.length;
    rv = await reviewPost({ kind: 'episode', id: String(amb.insertedId) }, admin);
    const ambAfter = await db.collection('billingrecoveryepisodes').findOne({ _id: amb.insertedId });
    check('review: ambiguous send — stays ambiguous, nothing re-sent or re-queued', rv.status === 200 && ambAfter?.steps?.[0]?.status === 'ambiguous' && ambAfter?.needsReview === false && inngestEvents.length === sendsBefore, ambAfter?.steps?.[0]?.status);
    rv = await reviewPost({ kind: 'subscription', id: String(amb.insertedId) }, admin);
    check('review: unknown kinds are rejected (400)', rv.status === 400, rv.status);
    const releaseLog = await db.collection('adminactionlogs').findOne({ action: 'billing.release_hold' });
    check('release hold: audited with old → new values', releaseLog?.metadata?.old?.paymentAccessHold === true && releaseLog?.metadata?.new?.paymentAccessHold === false, releaseLog?.metadata);

    // Trial toggle round trip through the same API the dashboard uses; end state OFF.
    await putPolicy({ trial: { offerEnabled: true, trialMonths: 3 } });
    await putPolicy({ trial: { offerEnabled: false, trialMonths: 3 } });
    const finalPolicy = await adminGet('/api/admin/billing-policy');
    check('end state: trial offer OFF and reminders OFF', finalPolicy?.policy?.offerEnabled === false && finalPolicy?.reminders?.enabled === false, { trial: finalPolicy?.policy?.offerEnabled, reminders: finalPolicy?.reminders?.enabled });
    }
  } finally {
    try {
      if (process.platform === 'win32' && child.pid) execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      else child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    await mongoose.disconnect();
    await mem.stop();
    inngest.close();
    if (failures) {
      const tail = serverLog.join('').split('\n').filter((l) => /error|billing/i.test(l)).slice(-40).join('\n');
      console.log('\n[server log, billing/error lines]\n' + tail);
    }
  }

  console.log(`\n[check] ${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
