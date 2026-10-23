/**
 * Owner WhatsApp policy through the REAL services against an in-memory
 * MongoDB. WhatsApp delivery is mocked by the existing outbound suppression
 * (QA_SUPPRESS_WHATSAPP_SENDS=true): every send is recorded as a MessageQueue
 * row and no provider is contacted. Counting those rows = counting messages.
 *
 * Run: npx tsx --test tests/workflow/owner-whatsapp-notifications.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runDurably } from '../helpers/inngestReplay';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|DO_SPACES)_/.test(k)) delete process.env[k];
process.env.GROQ_API_KEY = 'test-unused';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:9'; // closed port → any AI call fails fast, never leaves the machine
// Fake template ids — they only label the suppressed MessageQueue rows.
process.env.WHATSAPP_PROVIDER = 'twilio';
process.env.TWILIO_TEMPLATE_NOTIFICATION = 'HXnotification_test';
process.env.TWILIO_TEMPLATE_LOGIN_OTP = 'HXotp_test';
process.env.TWILIO_TEMPLATE_PAYMENT_RECEIVED = 'HXpayment_test';
process.env.TWILIO_TEMPLATE_INVOICE_READY = 'HXinvoice_test';
process.env.TWILIO_TEMPLATE_WELCOME_CUSTOMER = 'HXwelcome_test';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
/** inngest.send is captured, never delivered. */
const dispatched: any[] = [];

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_owner_whatsapp_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async (e: any) => { dispatched.push(e); return { ids: [] }; };
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    Audit: (await import('../../src/models/Audit')).default,
    Review: (await import('../../src/models/Review')).default,
    Lead: (await import('../../src/models/Lead')).default,
    Subscription: (await import('../../src/models/Subscription')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
    OwnerNotifyDigest: (await import('../../src/models/OwnerNotifyDigest')).default,
    BookingConversation: (await import('../../src/models/BookingConversation')).default,
    Notification: (await import('../../src/models/Notification')).default,
    owner: await import('../../src/services/ownerNotify'),
    lifecycle: await import('../../src/services/lifecycle/notify'),
    send: await import('../../src/services/whatsapp/send'),
    twilio: await import('../../src/services/twilio/client'),
    consent: await import('../../src/lib/whatsappConsent'),
    entitlements: await import('../../src/lib/billing/applyEntitlements'),
    activation: await import('../../src/services/billing/customerActivation'),
    fns: await import('../../src/services/inngest/functions'),
    autopilot: await import('../../src/lib/auditAutopilot'),
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

/** A subscribed, Google-connected workspace with an owner who has a phone. */
async function workspace(over: Record<string, unknown> = {}, prefs: Record<string, boolean> = {}) {
  const n = ++seq;
  const userId = new m.mongoose.Types.ObjectId();
  const phone = `+9198765${String(n).padStart(5, '0')}`;
  const b = await m.Business.create({
    name: `Shop ${n}`, category: 'Bakery', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(),
    subscriptionStatus: 'active', googleConnected: true, googleLocationId: `locations/${n}`, ...over,
  } as any);
  await m.User.create({ _id: userId, fullName: `Owner ${n}`, email: `owner${n}@example.invalid`, phone, role: 'CLIENT', businessIds: [b._id], notificationPreferences: prefs } as any);
  return { businessId: String(b._id), userId: String(userId), phone, name: b.name as string };
}

const sentTo = (phone: string) => m.MessageQueue.find({ 'payload.phone': phone }).lean();
const countTo = (phone: string) => m.MessageQueue.countDocuments({ 'payload.phone': phone });

test('routine activity (posts, photos, content, review replies) sends and queues no WhatsApp', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  for (const event of ['post_published', 'photo_published', 'content_batch_generated', 'review_reply_sent', 'review_reply_drafted', 'festival_prompt'] as const) {
    const res = await m.owner.notifyOwner(w.businessId, { event, text: `Today's ${event}` });
    assert.deepEqual(res, { status: 'skipped', reason: 'whatsapp_off_for_event' });
  }
  assert.equal(await countTo(w.phone), 0);
  assert.equal(await m.OwnerNotifyDigest.countDocuments({ businessId: w.businessId }), 0);
});

test('old queued digest rows are retired without sending', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  await m.OwnerNotifyDigest.create({ businessId: w.businessId, event: 'post_published', text: 'A post went live', count: 1 });
  const r = await m.owner.sendPendingOwnerDigests();
  assert.equal(r.sent, 0);
  assert.equal(await m.OwnerNotifyDigest.countDocuments({ businessId: w.businessId, sentAt: null }), 0);
  assert.equal(await countTo(w.phone), 0);
});

test('performance updates: at most 2 per business in a rolling 15 days', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await m.owner.notifyOwner(w.businessId, { event: i % 2 ? 'performance_digest' : 'weekly_update', text: `Hi ${w.name},\n\nUpdate ${i}` })).status);
  assert.deepEqual(results, ['sent', 'sent', 'skipped', 'skipped']);
  assert.equal(await countTo(w.phone), 2);

  // Sends roll out of the window: with one send 16 days ago and one 10 days ago, exactly one more fits.
  await m.Business.updateOne({ _id: w.businessId }, { $set: { performanceUpdateSentAt: [new Date(Date.now() - 16 * DAY), new Date(Date.now() - 10 * DAY)] } });
  assert.equal((await m.owner.notifyOwner(w.businessId, { event: 'weekly_update', text: 'x' })).status, 'sent', 'the 16-day-old send no longer counts');
  assert.equal((await m.owner.notifyOwner(w.businessId, { event: 'weekly_update', text: 'x' })).status, 'skipped');
  const biz: any = await m.Business.findById(w.businessId).lean();
  assert.equal(biz.performanceUpdateSentAt.length, 2, 'only the latest two send times are kept');
});

test('performance updates: concurrent jobs and retries cannot exceed the limit', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  const results = await Promise.all(Array.from({ length: 8 }, () => m.owner.notifyOwner(w.businessId, { event: 'performance_digest', text: 'Hi,\n\nYour update' })));
  assert.equal(results.filter((r: any) => r.status === 'sent').length, 2);
  assert.equal(await countTo(w.phone), 2);
});

test('a failed performance-update send gives its slot back (no lost or duplicate slot)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  // A {{2}} longer than the template allows fails locally, before any provider call.
  const failed = await m.owner.notifyOwner(w.businessId, { event: 'weekly_update', text: 'x'.repeat(2000) });
  assert.equal(failed.status, 'failed');
  assert.equal(await countTo(w.phone), 0, 'invalid template variables are never sent');
  const biz: any = await m.Business.findById(w.businessId).lean();
  assert.equal((biz.performanceUpdateSentAt || []).length, 0);
  assert.equal((await m.owner.notifyOwner(w.businessId, { event: 'weekly_update', text: 'ok' })).status, 'sent');
  assert.equal((await m.owner.notifyOwner(w.businessId, { event: 'weekly_update', text: 'ok' })).status, 'sent');
});

test('owner preferences and opt-outs are respected, and an opted-out owner uses no slot', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace({}, { weeklyUpdateWhatsApp: false });
  assert.deepEqual(await m.owner.notifyOwner(w.businessId, { event: 'weekly_update', text: 'x' }), { status: 'skipped', reason: 'opted_out' });
  const biz: any = await m.Business.findById(w.businessId).lean();
  assert.equal((biz.performanceUpdateSentAt || []).length, 0);
  const off = await workspace({}, { whatsAppNotificationsEnabled: false });
  assert.deepEqual(await m.owner.notifyOwner(off.businessId, { event: 'new_lead', text: 'x' }), { status: 'skipped', reason: 'opted_out' });
  // A workspace that is not subscribed gets no business-activity WhatsApp.
  const lead = await workspace({ subscriptionStatus: 'canceled' });
  assert.deepEqual(await m.owner.notifyOwner(lead.businessId, { event: 'critical_review', text: 'x' }), { status: 'skipped', reason: 'not_eligible' });
  assert.equal(await countTo(w.phone) + await countTo(off.phone) + await countTo(lead.phone), 0);
});

test('billing notices still go out: not limited, not blocked by business preferences', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace({ googleConnected: false }, { whatsAppNotificationsEnabled: false });
  for (let i = 0; i < 3; i++) assert.equal((await m.owner.notifyOwner(w.businessId, { event: 'billing_past_due', text: `Hi ${w.name},\n\nThere is an issue with your payment.` })).status, 'sent');
  assert.equal(await countTo(w.phone), 3);
  const [row]: any[] = await sentTo(w.phone);
  assert.equal(row.payload.contentSid, 'HXnotification_test');
  assert.equal(row.payload.variables['1'], w.name, 'the greeting name becomes {{1}}');
  assert.equal(row.payload.variables['2'], 'There is an issue with your payment.', 'no second "Hi" inside {{2}}');
});

async function seedReview(businessId: string, over: Record<string, unknown>) {
  return m.Review.create({ businessId, tenantId: businessId, reviewer: 'A customer', rating: 4, reviewText: 'Nice', sentiment: 'positive', source: 'gbp_api', postedAt: new Date(Date.now() - 3 * DAY), replyCheckedAt: new Date(), replyStatus: 'PENDING', ...over } as any);
}

test('review reminder: only when verified reviews need a reply; once per week; stops when nothing is pending', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  // None of these qualify.
  await seedReview(w.businessId, { response: 'Thank you!', replyStatus: 'POSTED' });
  await seedReview(w.businessId, { replyCheckedAt: new Date(Date.now() - 20 * DAY) }); // reply state not read recently
  await seedReview(w.businessId, { postedAt: new Date(Date.now() - 40 * DAY) }); // older than 30 days
  await seedReview(w.businessId, { source: 'mock' });
  const now = new Date();
  assert.equal((await m.lifecycle.sendReviewAttentionReminder(w.businessId, w.name, now)).status, 'nothing_pending');
  assert.equal(await countTo(w.phone), 0, 'a new review that is already answered is not a reason');

  const pending = await seedReview(w.businessId, { replyStatus: 'DRAFT' });
  const first = await m.lifecycle.sendReviewAttentionReminder(w.businessId, w.name, now);
  assert.deepEqual([first.status, first.pending], ['sent', 1]);
  const again = await m.lifecycle.sendReviewAttentionReminder(w.businessId, w.name, now);
  assert.deepEqual([again.status, again.reason], ['skipped', 'already_sent_this_week']);
  assert.equal(await countTo(w.phone), 1);
  const [row]: any[] = await sentTo(w.phone);
  assert.match(row.payload.variables['2'], /1 customer review from the last 30 days/);
  assert.match(row.payload.variables['2'], /suggested reply waiting for your approval/);

  // Next week, still pending → one more (different wording).
  const nextWeek = new Date(now.getTime() + 7 * DAY);
  assert.equal((await m.lifecycle.sendReviewAttentionReminder(w.businessId, w.name, nextWeek)).status, 'sent');
  const rows: any[] = await sentTo(w.phone);
  assert.notEqual(rows[0].payload.variables['2'], rows[1].payload.variables['2']);

  // Replied → the reminder stops.
  await m.Review.updateOne({ _id: pending._id }, { $set: { response: 'Thanks!', replyStatus: 'POSTED' } });
  assert.equal((await m.lifecycle.sendReviewAttentionReminder(w.businessId, w.name, new Date(now.getTime() + 14 * DAY))).status, 'nothing_pending');
  assert.equal(await countTo(w.phone), 2);
});

test('review reminder: concurrent runs in the same week send once', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  await seedReview(w.businessId, {});
  const now = new Date();
  const results = await Promise.all(Array.from({ length: 5 }, () => m.lifecycle.sendReviewAttentionReminder(w.businessId, w.name, now)));
  assert.equal(results.filter((r: any) => r.status === 'sent').length, 1);
  assert.equal(await countTo(w.phone), 1);
});

async function completedAudit(w: { businessId: string; userId: string; name: string }, over: Record<string, unknown> = {}) {
  return m.Audit.create({
    tenantId: w.businessId, userId: w.userId, organizationId: 'org', businessId: w.businessId, businessName: w.name,
    location: 'Pune', status: 'COMPLETED', auditKind: 'monthly', period: `2026-${String(++seq).padStart(2, '0')}`, ...over,
  } as any);
}

test('monthly report: one notice per report, even for duplicate or concurrent jobs', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  const audit = await completedAudit(w);
  await Promise.all([
    m.lifecycle.notifyMonthlyReport(w.businessId, String(audit._id), {}),
    m.lifecycle.notifyMonthlyReport(w.businessId, String(audit._id), {}),
  ]);
  await m.lifecycle.notifyMonthlyReport(w.businessId, String(audit._id), {});
  const rows: any[] = await sentTo(w.phone);
  assert.equal(rows.length, 1);
  assert.match(rows[0].payload.variables['2'], /^\*📊 Your monthly Google report is ready\* — /);
  assert.match(rows[0].payload.variables['2'], new RegExp(`View your full report: https://app\\.example\\.test/dashboard/audit/${audit._id}$`));
  assert.equal(await m.Notification.countDocuments({ businessId: w.businessId, type: 'monthly_report' }), 1, 'in-app notice also once');
});

test('monthly report: the summary is built from the stored report (loaded when the caller has none)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  const monthly = {
    reviews: { newReviews: 2, ratingAfter: 4.7 }, performance: { status: 'compared', rows: [] },
    planCompleted: [{ findingId: 'a', status: 'VERIFIED' }], planPending: [],
    improved: ['Website clicks: 3 → 5 (+66.7%)'], declined: [], remainingIssues: ['No business hours on the listing'],
  };
  const audit = await completedAudit(w, { auditData: { monthly } });
  await m.lifecycle.notifyMonthlyReport(w.businessId, String(audit._id)); // as the deferred job calls it
  const [row]: any[] = await sentTo(w.phone);
  const text = row.payload.variables['2'];
  assert.match(text, /• New Google reviews: 2 \(rating 4\.7★\) • Plan actions: 1 completed \(1 verified\), 0 pending/);
  assert.match(text, /What improved: • Website clicks: 3 → 5 \(\+66\.7%\)/);
  assert.match(text, /Needs attention: • No business hours on the listing/);
  assert.equal(row.payload.variables['1'], w.name);
});

test('monthly summary takes priority over the 15-day limit, and then counts toward it', async (t) => {
  if (skipReason) return t.skip(skipReason);
  // Two routine updates already used the window: the monthly summary still goes.
  const full = await workspace();
  for (let i = 0; i < 2; i++) assert.equal((await m.owner.notifyOwner(full.businessId, { event: 'weekly_update', text: 'Hi,\n\nUpdate' })).status, 'sent');
  assert.equal((await m.owner.notifyOwner(full.businessId, { event: 'monthly_report', text: 'Hi,\n\nMonthly' })).status, 'sent');
  assert.equal(await countTo(full.phone), 3);
  const biz: any = await m.Business.findById(full.businessId).lean();
  assert.equal(biz.performanceUpdateSentAt.length, 2, 'still only the latest two kept');
  assert.ok(Date.now() - new Date(biz.performanceUpdateSentAt[1]).getTime() < 60_000, 'the monthly send is the newest slot');
  assert.equal((await m.owner.notifyOwner(full.businessId, { event: 'performance_digest', text: 'x' })).reason, 'performance_update_limit');

  // A fresh window: monthly + one routine update fill it; the next routine update waits.
  const w = await workspace();
  assert.equal((await m.owner.notifyOwner(w.businessId, { event: 'monthly_report', text: 'Hi,\n\nMonthly' })).status, 'sent');
  assert.equal((await m.owner.notifyOwner(w.businessId, { event: 'weekly_update', text: 'x' })).status, 'sent');
  assert.deepEqual(await m.owner.notifyOwner(w.businessId, { event: 'performance_digest', text: 'x' }), { status: 'skipped', reason: 'performance_update_limit' });
  assert.equal(await countTo(w.phone), 2);

  // An opted-out owner: nothing sent, no slot used.
  const off = await workspace({}, { reportReadyWhatsApp: false });
  assert.equal((await m.owner.notifyOwner(off.businessId, { event: 'monthly_report', text: 'x' })).status, 'skipped');
  assert.equal(((await m.Business.findById(off.businessId).lean()) as any).performanceUpdateSentAt?.length ?? 0, 0);
});

test('monthly report in quiet hours: queued for the durable job, delivered once at 09:00 IST', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  const audit = await completedAudit(w);
  const id = String(audit._id);
  dispatched.length = 0;
  const night = new Date('2026-10-22T17:00:00Z'); // 22:30 IST
  assert.equal(await m.lifecycle.deliverMonthlyReportNotice(w.businessId, id, {}, night), 'deferred');
  assert.equal(await countTo(w.phone), 0, 'nothing at night');
  assert.equal(await m.Notification.countDocuments({ businessId: w.businessId, type: 'monthly_report' }), 0);
  assert.deepEqual(dispatched.map((e) => [e.name, e.id]), [['lifecycle/monthly-report.notice', `monthly-report-notice-${id}`]]);

  // The durable job, through the real Inngest engine, with the clock at 22:30 IST.
  t.mock.timers.enable({ apis: ['Date'], now: night });
  let sentDuringSleep = -1;
  let wakeAt: unknown = null;
  let out: any;
  try {
    out = await runDurably(m.fns.monthlyReportNotice, { data: dispatched[0].data }, {
      onSleep: async (_id, op) => { sentDuringSleep = await countTo(w.phone); wakeAt = op; },
    });
  } finally {
    t.mock.timers.reset();
  }
  const tl: string[] = out.timeline;
  assert.ok(tl.indexOf('sleep:wait-until-0900-ist') < tl.indexOf('run:notify-owner'), tl.join(' → '));
  assert.equal(sentDuringSleep, 0, 'nothing before the wake-up');
  assert.match(JSON.stringify(wakeAt), /2026-10-23T03:30:00/, '09:00 IST next morning');
  assert.equal(out.result.deferredUntil, '2026-10-23T03:30:00.000Z');
  assert.equal(await countTo(w.phone), 1);
  assert.equal(await m.Notification.countDocuments({ businessId: w.businessId, type: 'monthly_report' }), 1);
  assert.equal(((await m.Business.findById(w.businessId).lean()) as any).monthlyReportNoticePending, undefined, 'pending record cleared once claimed');
  // The hourly safety net finds nothing left to send.
  assert.equal((await m.lifecycle.sendDueMonthlyReportNotices(new Date('2026-10-23T04:00:00Z'))).processed, 0);
  assert.equal(await countTo(w.phone), 1);

  // A duplicate job (or a second event) for the same report sends nothing more.
  await runDurably(m.fns.monthlyReportNotice, { data: dispatched[0].data });
  assert.equal(await countTo(w.phone), 1);

  // Daytime: sent straight away, nothing queued.
  const day = await workspace();
  const a2 = await completedAudit(day);
  dispatched.length = 0;
  assert.equal(await m.lifecycle.deliverMonthlyReportNotice(day.businessId, String(a2._id), {}, new Date('2026-10-22T06:00:00Z')), 'sent');
  assert.equal(dispatched.length, 0);
  assert.equal(await countTo(day.phone), 1);
});

test('weekly run: the review alert only when reviews need attention, one WhatsApp per week', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const now = new Date();
  // The once-per-week guarantee is WeeklyMonitor's unique index: build it before the first run (a fresh test DB builds it lazily).
  await (await import('../../src/models/WeeklyMonitor')).default.init();
  const w = await workspace();
  await seedReview(w.businessId, {});
  const first = await m.lifecycle.runWeeklyMonitoring(w.businessId, now);
  assert.equal(first.whatsapp, 'review_attention_sent');
  assert.equal((await m.lifecycle.runWeeklyMonitoring(w.businessId, now)).status, 'already_ran');
  assert.equal(await countTo(w.phone), 1, 'one WhatsApp for the week (the alert, not also the weekly update)');
  const [row]: any[] = await sentTo(w.phone);
  assert.match(row.payload.variables['2'], /^\*⭐ [^*]+\* — 1 customer review from the last 30 days/);

  const quiet = await workspace();
  await seedReview(quiet.businessId, { response: 'Thanks!', replyStatus: 'POSTED' });
  const r = await m.lifecycle.runWeeklyMonitoring(quiet.businessId, now);
  assert.notEqual(r.whatsapp, 'review_attention_sent');
  assert.equal(await countTo(quiet.phone), 0, 'nothing pending and nothing new → no WhatsApp');
});

test('"add your business category" WhatsApp: two sends in total; the in-app reminder continues', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace({ category: 'Local Business' });
  const nudgeAgo = (days: number) => m.Business.updateOne({ _id: w.businessId }, { $set: { auditAutopilotCategoryNudgedAt: new Date(Date.now() - days * DAY) } });
  const inApp = () => m.Notification.countDocuments({ businessId: w.businessId, type: 'profile_incomplete' });

  await Promise.all(Array.from({ length: 4 }, () => m.autopilot.maybeStartAuditAutopilot(w.businessId)));
  assert.equal(await countTo(w.phone), 1, 'concurrent callers send once');
  await m.autopilot.maybeStartAuditAutopilot(w.businessId);
  assert.equal(await countTo(w.phone), 1, '3-day throttle');
  await nudgeAgo(4);
  await m.autopilot.maybeStartAuditAutopilot(w.businessId);
  assert.equal(await countTo(w.phone), 2);
  for (let i = 0; i < 3; i++) {
    await nudgeAgo(4);
    await m.autopilot.maybeStartAuditAutopilot(w.businessId);
  }
  assert.equal(await countTo(w.phone), 2, 'never a third WhatsApp');
  assert.equal(await inApp(), 5, 'the in-app reminder keeps its 3-day cadence');

  // Nudged before the counter existed → counted as one already sent.
  const legacy = await workspace({ category: 'Local Business', auditAutopilotCategoryNudgedAt: new Date(Date.now() - 10 * DAY) });
  for (let i = 0; i < 3; i++) {
    await m.autopilot.maybeStartAuditAutopilot(legacy.businessId);
    await m.Business.updateOne({ _id: legacy.businessId }, { $set: { auditAutopilotCategoryNudgedAt: new Date(Date.now() - 4 * DAY) } });
  }
  assert.equal(await countTo(legacy.phone), 1);

  // An owner who turned WhatsApp off is not counted, so nothing is used up.
  const off = await workspace({ category: 'Local Business' }, { whatsAppNotificationsEnabled: false });
  await m.autopilot.maybeStartAuditAutopilot(off.businessId);
  assert.equal(await countTo(off.phone), 0);
  assert.equal(((await m.Business.findById(off.businessId).lean()) as any).auditAutopilotCategoryNudgeWhatsApps, 0);
  assert.equal(m.autopilot.CATEGORY_NUDGE_WHATSAPP_LIMIT, 2);
});

test('monthly report: nothing is claimed for a report that did not complete', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  const failed = await completedAudit(w, { status: 'FAILED' });
  await m.lifecycle.notifyMonthlyReport(w.businessId, String(failed._id), {});
  assert.equal(await countTo(w.phone), 0);
  assert.equal(await m.lifecycle.claimReportOwnerNotice(String(failed._id)), false);
  const ok = await completedAudit(w);
  const claims = await Promise.all(Array.from({ length: 5 }, () => m.lifecycle.claimReportOwnerNotice(String(ok._id))));
  assert.equal(claims.filter(Boolean).length, 1, 'duplicate report-ready events claim once');
});

test('login OTP still sends as the authentication template, one call', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = '+919876599999';
  const res = await m.send.sendOtpMessage(phone, 'Your code is 123456', '123456');
  assert.equal(res.success, true);
  const rows: any[] = await sentTo(phone);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.contentSid, 'HXotp_test');
  assert.deepEqual(rows[0].payload.variables, { '1': '123456' });
});

test('a template with an invalid variable is refused before it is sent', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = '+919876588888';
  const res = await m.twilio.sendTemplateMessage(phone, 'HXany', { '1': 'Two\nlines' });
  assert.equal(res.success, false);
  assert.equal(await countTo(phone), 0);
});

test('payment: activation itself sends no WhatsApp (the per-charge confirmation is billingWhatsApp\'s); no invoice/welcome', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace({ googleConnected: false, subscriptionStatus: undefined });
  await m.entitlements.activateBusinessPlan(w.businessId, { eventType: 'subscription.activated' });
  assert.equal(await countTo(w.phone), 0, 'confirmations come from notifyPaymentConfirmed (tests/workflow/billing-whatsapp.test.ts)');

  await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Owner', phone: w.phone, currentStage: 'NURTURING' } as any);
  await m.Subscription.create({ userId: w.userId, planType: 'Pro', billingStatus: 'Active' } as any);
  await m.activation.runCustomerActivationSequence(w.userId, w.businessId, { paymentId: 'pay_1', amount: 100, currency: 'INR' });
  const rows: any[] = await sentTo(w.phone);
  assert.ok(!rows.some((r) => r.payload.contentSid === 'HXinvoice_test' || r.payload.contentSid === 'HXwelcome_test'), 'no invoice or welcome template');
  assert.equal((await m.Lead.findOne({ phone: w.phone }).lean())?.currentStage, 'CUSTOMER', 'ownership still moves to CUSTOMER');

  await m.entitlements.activateBusinessPlan(w.businessId, { eventType: 'subscription.charged' });
  assert.equal(await countTo(w.phone), 0);
});

test('consent: a website-form line is not a WhatsApp message; a real WhatsApp reply is', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { phoneDedupeKey } = await import('../../src/lib/phone');
  const formPhone = '+919876577777';
  await m.BookingConversation.create({ leadPhone: formPhone, phoneKey: phoneDedupeKey(formPhone), status: 'active', messages: [{ role: 'lead', text: 'Hi, I requested a demo', at: new Date(), via: 'form' }] } as any);
  assert.equal(await m.consent.hasPhoneMessagedPlatformBefore(phoneDedupeKey(formPhone)), false);
  const waPhone = '+919876566666';
  await m.BookingConversation.create({ leadPhone: waPhone, phoneKey: phoneDedupeKey(waPhone), status: 'active', messages: [{ role: 'lead', text: 'demo please', at: new Date(), via: 'whatsapp' }] } as any);
  assert.equal(await m.consent.hasPhoneMessagedPlatformBefore(phoneDedupeKey(waPhone)), true);
});

test('monthly report in quiet hours, queueing FAILS: nothing at night, the hourly sweep delivers it once after 09:00 IST', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const client = await import('../../src/services/inngest/client');
  const realSend = (client.inngest as any).send;
  (client.inngest as any).send = async () => { throw new Error('Inngest unavailable'); };
  const w = await workspace();
  const audit = await completedAudit(w);
  const night = new Date('2026-10-22T18:30:00Z'); // 00:00 IST
  try {
    assert.equal(await m.lifecycle.deliverMonthlyReportNotice(w.businessId, String(audit._id), {}, night), 'deferred');
  } finally {
    (client.inngest as any).send = realSend;
  }
  assert.equal(await countTo(w.phone), 0, 'never sent at night as a fallback');
  const pending: any = ((await m.Business.findById(w.businessId).lean()) as any).monthlyReportNoticePending;
  assert.equal(String(pending.auditId), String(audit._id));
  assert.equal(new Date(pending.dueAt).toISOString(), '2026-10-23T03:30:00.000Z');

  // Hourly cron runs through the night: still quiet → nothing.
  for (const iso of ['2026-10-22T19:00:00Z', '2026-10-22T23:00:00Z', '2026-10-23T03:00:00Z']) {
    assert.equal((await m.lifecycle.sendDueMonthlyReportNotices(new Date(iso))).skipped, 'quiet_hours', iso);
  }
  assert.equal(await countTo(w.phone), 0);
  // 04:00 UTC = 09:30 IST: delivered, once (in-app + WhatsApp), then cleared.
  await Promise.all([
    m.lifecycle.sendDueMonthlyReportNotices(new Date('2026-10-23T04:00:00Z')),
    m.lifecycle.sendDueMonthlyReportNotices(new Date('2026-10-23T04:00:00Z')),
  ]);
  await m.lifecycle.sendDueMonthlyReportNotices(new Date('2026-10-23T05:00:00Z'));
  assert.equal(await countTo(w.phone), 1);
  assert.equal(await m.Notification.countDocuments({ businessId: w.businessId, type: 'monthly_report' }), 1);
  assert.equal(((await m.Business.findById(w.businessId).lean()) as any).monthlyReportNoticePending, undefined);
  // A late Inngest run for the same report (if the event did get through) adds nothing.
  await runDurably(m.fns.monthlyReportNotice, { data: { businessId: w.businessId, auditId: String(audit._id) } });
  assert.equal(await countTo(w.phone), 1);
});

test('monthly sweep: a notice found more than 3 days late is dropped, not sent; nothing recordable → logged, not sent at night', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  const audit = await completedAudit(w);
  await m.Business.updateOne({ _id: w.businessId }, { $set: { monthlyReportNoticePending: { auditId: audit._id, dueAt: new Date('2026-10-01T03:30:00Z') } } });
  const r = await m.lifecycle.sendDueMonthlyReportNotices(new Date('2026-10-23T06:00:00Z'));
  assert.equal(r.expired, 1);
  assert.equal(await countTo(w.phone), 0);
  assert.equal(((await m.Business.findById(w.businessId).lean()) as any).monthlyReportNoticePending, undefined);

  // Neither the pending record (unknown business) nor the job can be saved.
  const client = await import('../../src/services/inngest/client');
  const realSend = (client.inngest as any).send;
  (client.inngest as any).send = async () => { throw new Error('Inngest unavailable'); };
  try {
    const ghost = String(new m.mongoose.Types.ObjectId());
    assert.equal(await m.lifecycle.deliverMonthlyReportNotice(ghost, String(audit._id), {}, new Date('2026-10-22T18:30:00Z')), 'unscheduled');
  } finally {
    (client.inngest as any).send = realSend;
  }
  assert.equal(await countTo(w.phone), 0);
});
