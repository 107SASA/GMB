/**
 * Owner WhatsApp policy (Oct 2026) — pure rules: which events reach WhatsApp,
 * the 2-per-15-days performance limit, the review-attention definition and
 * copy, template-variable checks, and the review-request identical-template cap.
 * Run: node --experimental-strip-types --test tests/integration/owner-whatsapp-policy.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OWNER_WHATSAPP_DELIVERY, ownerWhatsAppDelivery, isBillingOwnerEvent } from '../../src/services/ownerNotifyEligibility.ts';
import {
  PERFORMANCE_UPDATE_LIMIT,
  PERFORMANCE_UPDATE_WINDOW_DAYS,
  performanceUpdateAllowed,
  performanceUpdateClaimFilter,
} from '../../src/lib/ownerWhatsAppLimits.ts';
import { reviewAttentionFilter, reviewAttentionText, composeWeeklyWhatsApp } from '../../src/services/lifecycle/weekly.ts';
import { composeMonthlyWhatsApp } from '../../src/services/lifecycle/monthly.ts';
import {
  buildNotificationVariables,
  composeOwnerMessage,
  notificationBodyForTemplate,
  NOTIFICATION_BODY_MAX,
  unsafeTemplateVariableReason,
} from '../../src/lib/whatsappOutbound.ts';
import {
  identicalReviewTemplateCapReached,
  MAX_IDENTICAL_REVIEW_TEMPLATE_SENDS,
  REVIEW_REMINDER_1_DEFAULT,
  REVIEW_REMINDER_2_DEFAULT,
  REVIEW_REQUEST_INITIAL_DEFAULT,
  isLinkPreviewRequest,
} from '../../src/lib/reviewRequestFlow.ts';
import { nextIstBusinessHourStart, ownerQuietHoursDeferUntil, OWNER_QUIET_END_HOUR, OWNER_QUIET_START_HOUR } from '../../src/lib/istSchedule.ts';

const DAY = 86_400_000;
const src = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');

test('routine activity events never reach WhatsApp', () => {
  for (const e of ['post_published', 'photo_published', 'content_batch_generated', 'review_reply_sent', 'review_reply_drafted', 'festival_prompt', 'review_reminder'] as const) {
    assert.equal(ownerWhatsAppDelivery(e), 'off', e);
  }
  assert.ok(!Object.values(OWNER_WHATSAPP_DELIVERY).includes('digest' as any), 'no event is digest-delivered');
});

test('performance summaries are capped, review attention is weekly, action/transactional events are immediate', () => {
  assert.equal(ownerWhatsAppDelivery('weekly_update'), 'performance_update');
  assert.equal(ownerWhatsAppDelivery('performance_digest'), 'performance_update');
  assert.equal(ownerWhatsAppDelivery('review_attention'), 'weekly');
  for (const e of ['new_lead', 'critical_review', 'billing_activated', 'billing_past_due', 'billing_canceled', 'report_ready', 'demo_booking'] as const) {
    assert.equal(ownerWhatsAppDelivery(e), 'immediate', e);
  }
  // The monthly summary is never held back by the limit, but counts toward it.
  assert.equal(ownerWhatsAppDelivery('monthly_report'), 'performance_priority');
  assert.match(src('services/ownerNotify.ts'), /delivery === 'performance_priority'[\s\S]{0,200}performanceUpdateClaimUpdate\(new Date\(\)\)/);
  // Billing is never subject to the performance limit or business preferences.
  assert.equal(isBillingOwnerEvent('billing_past_due'), true);
});

test('rolling limit: at most 2 performance updates in any 15 days', () => {
  assert.equal(PERFORMANCE_UPDATE_LIMIT, 2);
  assert.equal(PERFORMANCE_UPDATE_WINDOW_DAYS, 15);
  const now = new Date('2026-11-01T10:00:00Z');
  const ago = (d: number) => new Date(now.getTime() - d * DAY);
  assert.equal(performanceUpdateAllowed([], now), true);
  assert.equal(performanceUpdateAllowed([ago(1)], now), true);
  assert.equal(performanceUpdateAllowed([ago(14), ago(1)], now), false);
  assert.equal(performanceUpdateAllowed([ago(15), ago(1)], now), true);

  // Simulate a daily attempt for 60 days: no 15-day window ever holds 3 sends.
  const sent: Date[] = [];
  const start = new Date('2026-11-01T00:00:00Z').getTime();
  for (let d = 0; d < 60; d++) {
    const t = new Date(start + d * DAY);
    if (performanceUpdateAllowed(sent, t)) sent.push(t);
  }
  for (let i = 2; i < sent.length; i++) {
    assert.ok(sent[i].getTime() - sent[i - 2].getTime() >= 15 * DAY, `3 sends inside 15 days at ${sent[i].toISOString()}`);
  }
  assert.ok(sent.length >= 7, 'the limit still lets updates through over time');

  const filter: any = performanceUpdateClaimFilter(now);
  assert.deepEqual(Object.keys(filter.$or[0]), ['performanceUpdateSentAt.1']);
  assert.equal(filter.$or[1]['performanceUpdateSentAt.0'].$lte.getTime(), now.getTime() - 15 * DAY);
});

test('review attention: only verified, recent, unreplied Google reviews', () => {
  const now = new Date('2026-11-02T06:00:00Z');
  const f: any = reviewAttentionFilter('biz1', now);
  assert.equal(f.businessId, 'biz1');
  assert.deepEqual(f.source, { $ne: 'mock' });
  assert.equal(f.postedAt.$gte.getTime(), now.getTime() - 30 * DAY);
  assert.equal(f.replyCheckedAt.$gte.getTime(), now.getTime() - 8 * DAY, 'stale reply data is not evidence');
  assert.deepEqual(f.replyStatus, { $ne: 'POSTED' });
  assert.ok(f.$or.some((c: any) => c.response === ''), 'no reply text');
});

test('review attention copy alternates by week so identical copy is not repeated', () => {
  const a = reviewAttentionText({ businessName: 'Mulsetu', pending: 2, drafted: 0, weekKey: '2026-W44', reviewsLink: null })!;
  const b = reviewAttentionText({ businessName: 'Mulsetu', pending: 2, drafted: 0, weekKey: '2026-W45', reviewsLink: null })!;
  assert.notEqual(a, b);
  for (const t of [a, b]) {
    assert.match(t, /2 customer reviews from the last 30 days/);
    assert.match(t, /— Team Growwmatics$/);
  }
});

test('monthly report copy (no stored summary): bold heading, short description, one link', () => {
  const t = composeMonthlyWhatsApp(null, 'Mulsetu', 'https://app.example/dashboard/audit/a1');
  assert.match(t, /^Hi Mulsetu,\n\n\*📊 Your monthly Google report is ready\*\n\n/);
  assert.match(t, /View your full report: https:\/\/app\.example\/dashboard\/audit\/a1/);
  assert.match(t, /— Team Growwmatics$/);
  assert.equal(t.match(/https?:\/\//g)?.length, 1);
  assert.ok(t.length < 400);
});

/** A stored MonthlyReport with only the fields the WhatsApp reads. */
function monthlyReport(over: Record<string, unknown> = {}): any {
  return {
    reviews: { newReviews: 3, ratingAfter: 4.6 },
    performance: { status: 'compared', rows: [{ metric: 'Calls', previous: 10, current: 14, change: 4, pctChange: 40 }] },
    planCompleted: [{ findingId: 'a', status: 'VERIFIED' }, { findingId: 'b', status: 'EXECUTED' }, { findingId: 'c', status: 'EXECUTED' }],
    planPending: [{ findingId: 'd', status: 'PLANNED' }, { findingId: 'e', status: 'BLOCKED' }],
    improved: ['Calls: 10 → 14 (+40%)', 'Website clicks: 3 → 5 (+66.7%)', 'Direction requests: 1 → 2 (+100%)'],
    declined: ['Profile views: 200 → 180 (-10%)', 'Search position: #4 → #6'],
    remainingIssues: ['No business hours on the listing', 'Few recent photos', 'Description too short', 'No products', 'No Q&A'],
    ...over,
  };
}

test('monthly summary: stored improvements, completed/verified actions and top remaining issues — nothing invented', () => {
  const t = composeMonthlyWhatsApp(monthlyReport(), 'Mulsetu', 'https://app.example/dashboard/audit/a1');
  assert.match(t, /\*📊 Your monthly Google report is ready\*/);
  assert.match(t, /This month:\n• New Google reviews: 3 \(rating 4\.6★\)\n• Plan actions: 3 completed \(1 verified\), 2 pending/);
  assert.match(t, /What improved:\n• Calls: 10 → 14 \(\+40%\)\n• Website clicks: 3 → 5 \(\+66\.7%\)\n\n/, 'at most two improvements');
  assert.doesNotMatch(t, /Direction requests/);
  assert.match(t, /Needs attention:\n• Profile views: 200 → 180 \(-10%\)\n• No business hours on the listing\n• Few recent photos\n• 3 more issues in the report\n/);
  assert.doesNotMatch(t, /Search position/, 'one decline at most');
  assert.doesNotMatch(t, /unavailable/, 'measured periods are compared, not called unavailable');
  assert.doesNotMatch(t, /\n\n\n/, 'no runs of blank lines');
  assert.equal(t.match(/https?:\/\//g)?.length, 1, 'one link');

  // No evidence → no section. Nothing is called an improvement without a stored line.
  const quiet = composeMonthlyWhatsApp(monthlyReport({ improved: [], declined: [], remainingIssues: [], planCompleted: [], planPending: [], performance: { status: 'unavailable', rows: [] } }), 'Mulsetu', 'https://x.test/r');
  assert.doesNotMatch(quiet, /What improved|Needs attention|verified\)/);
  assert.match(quiet, /• Google performance data: unavailable for this period/);
  assert.match(quiet, /• Plan actions: 0 completed, 0 pending/);
  const first = composeMonthlyWhatsApp(monthlyReport({ improved: [], performance: { status: 'current_only', rows: [{ metric: 'Calls', previous: null, current: 7 }] } }), 'M', 'https://x.test/r');
  assert.match(first, /• Calls from Google: 7 \(first measured month\)/);
  assert.match(composeMonthlyWhatsApp(monthlyReport({ remainingIssues: ['Only one'] , declined: [] }), 'M', 'https://x.test/r'), /Needs attention:\n• Only one\n\n/);
});

test('monthly summary stays within the notification template when flattened, even with long stored lines', () => {
  const long = 'Search position for "best ceramic tile showroom near me in Kharadi Pune": not in top 20 → #3';
  const link = 'https://app.growwmatics.com/dashboard/audit/6720d6f1c2a4b9e8f1234567';
  const t = composeMonthlyWhatsApp(monthlyReport({ improved: [long, long], declined: [long], remainingIssues: [long, long, long, long] }), 'Mulsetu Tiles & Sanitaryware', link);
  for (const line of t.split('\n').filter((l) => l.startsWith('• '))) assert.ok(line.length <= 92, `bullet too long: ${line}`);
  const flat = notificationBodyForTemplate(t);
  assert.equal(flat.name, 'Mulsetu Tiles & Sanitaryware');
  assert.match(flat.text, /^\*📊 Your monthly Google report is ready\* — This month: • New Google reviews: 3/);
  assert.ok(flat.text.length <= NOTIFICATION_BODY_MAX, `flattened ${flat.text.length} chars`);
  assert.equal(flat.text.split(link).length, 2, 'the link is intact and appears once');
  assert.doesNotMatch(flat.text, /Team Growwmatics/, 'sign-off dropped for the template');
  const vars = buildNotificationVariables(flat.name, flat.text, true);
  assert.ok(vars.ok);
  assert.equal(unsafeTemplateVariableReason(vars.variables), null);
});

test('monthly template fit: optional detail gives way (issues → decline → improvements); heading, facts and the link never do', () => {
  const long = (tag: string) => `${tag} ${'x'.repeat(200)}`;
  const link = `https://app.growwmatics.com/dashboard/audit/6720d6f1c2a4b9e8f1234567?ref=${'a'.repeat(300)}`;
  const m = monthlyReport({ improved: [long('IMP1'), long('IMP2')], declined: [long('DEC1')], remainingIssues: [long('ISS1'), long('ISS2'), long('ISS3')] });
  const t = composeMonthlyWhatsApp(m, 'Mulsetu', link);
  const flat = notificationBodyForTemplate(t).text;
  assert.ok(flat.length <= NOTIFICATION_BODY_MAX, `flattened ${flat.length}`);
  assert.ok(flat.endsWith(`View your full report: ${link}`), 'the CTA and the whole link are the last thing kept');
  assert.match(flat, /^\*📊 Your monthly Google report is ready\* — This month: • New Google reviews: 3/);
  assert.match(flat, /Plan actions: 3 completed \(1 verified\), 2 pending/);
  assert.doesNotMatch(flat, /ISS1/, 'issue titles go first');
  assert.match(flat, /3 issues in the report/, 'the issue count stays');
  // Order of what is kept: improvements before the decline before issue titles.
  if (/DEC1/.test(flat)) assert.match(flat, /IMP1/);
  const vars = buildNotificationVariables('Mulsetu', flat, true);
  assert.ok(vars.ok && unsafeTemplateVariableReason(vars.variables) === null);
  // Nothing in the copy is ever cut mid-link: bullets are trimmed, links are not.
  for (const line of t.split('\n')) if (line.includes('https://')) assert.equal(line, `View your full report: ${link}`);
});

test('a link-preview fetch or HEAD request is not a customer click; real phone browsers are', () => {
  for (const ua of ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'WhatsApp/2.23.20.0 A', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'TelegramBot (like TwitterBot)', 'Slackbot-LinkExpanding 1.0', 'meta-externalagent/1.1']) {
    assert.equal(isLinkPreviewRequest({ method: 'GET', userAgent: ua }), true, ua);
  }
  assert.equal(isLinkPreviewRequest({ method: 'HEAD', userAgent: 'Mozilla/5.0' }), true);
  for (const ua of [
    'Mozilla/5.0 (Linux; Android 13; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    '',
  ]) {
    assert.equal(isLinkPreviewRequest({ method: 'GET', userAgent: ua }), false, ua || '(no user agent)');
  }
});

test('review attention copy: bold heading, short paragraphs, one link; flattens to one safe template line', () => {
  for (const weekKey of ['2026-W44', '2026-W45']) {
    const t = reviewAttentionText({ businessName: 'Mulsetu', pending: 3, drafted: 2, weekKey, reviewsLink: 'https://app.example/dashboard/reviews' })!;
    assert.match(t, /^Hi Mulsetu,\n\n\*⭐ [^*\n]+\*\n\n/);
    assert.doesNotMatch(t, /\n\n\n/);
    assert.equal(t.match(/https?:\/\//g)?.length, 1);
    assert.match(t, /3 customer reviews from the last 30 days/);
    assert.match(t, /2 of them already have a suggested reply waiting for your approval\./);
    const flat = notificationBodyForTemplate(t);
    assert.equal(flat.name, 'Mulsetu');
    assert.match(flat.text, /^\*⭐ [^*]+\* — 3 customer reviews/);
    assert.match(flat.text, /View reviews: https:\/\/app\.example\/dashboard\/reviews$/);
    assert.ok(flat.text.length < 400);
    const vars = buildNotificationVariables(flat.name, flat.text, true);
    assert.ok(vars.ok && unsafeTemplateVariableReason(vars.variables) === null);
  }
});

test('template flattening: only a whole-line bold heading gets the separator', () => {
  assert.equal(notificationBodyForTemplate('Hi A,\n\n*Heading*\n\nBody text.').text, '*Heading* — Body text.');
  assert.equal(notificationBodyForTemplate('Hi A,\n\nThe *word* is bold.\nNext.').text, 'The *word* is bold. Next.');
  assert.equal(notificationBodyForTemplate('Hi A,\n\nBody\n\n*Last line*').text, 'Body *Last line*');
});

test('Asia/Kolkata clock: business hours and owner quiet hours ignore the server timezone', () => {
  const at = (iso: string) => new Date(iso);
  // 9–20 IST business hours.
  assert.equal(nextIstBusinessHourStart(at('2026-10-22T02:00:00Z'), 9, 20)?.toISOString(), '2026-10-22T03:30:00.000Z', '07:30 IST → 09:00 IST');
  assert.equal(nextIstBusinessHourStart(at('2026-10-22T05:00:00Z'), 9, 20), null, '10:30 IST is inside');
  assert.equal(nextIstBusinessHourStart(at('2026-10-22T03:30:00Z'), 9, 20), null, '09:00 IST exactly is inside');
  assert.equal(nextIstBusinessHourStart(at('2026-10-22T14:30:00Z'), 9, 20)?.toISOString(), '2026-10-23T03:30:00.000Z', '20:00 IST → next morning');
  assert.equal(nextIstBusinessHourStart(at('2026-10-22T19:00:00Z'), 9, 20)?.toISOString(), '2026-10-23T03:30:00.000Z', '00:30 IST (next IST day) → that morning');
  // Owner quiet hours 21:00–09:00 IST.
  assert.equal(ownerQuietHoursDeferUntil(at('2026-10-22T10:00:00Z')), null, '15:30 IST sends now');
  assert.equal(ownerQuietHoursDeferUntil(at('2026-10-22T15:29:00Z')), null, '20:59 IST sends now');
  assert.equal(ownerQuietHoursDeferUntil(at('2026-10-22T15:30:00Z'))?.toISOString(), '2026-10-23T03:30:00.000Z', '21:00 IST → 09:00 IST');
  assert.equal(ownerQuietHoursDeferUntil(at('2026-10-22T21:00:00Z'))?.toISOString(), '2026-10-23T03:30:00.000Z', '02:30 IST → 09:00 IST same day');
  assert.equal(ownerQuietHoursDeferUntil(at('2026-10-23T03:30:00Z')), null, '09:00 IST sends');
  assert.equal(OWNER_QUIET_START_HOUR, 21);
  assert.equal(OWNER_QUIET_END_HOUR, 9);
  const jobs = src('services/inngest/functions.ts');
  assert.match(jobs, /nextIstBusinessHourStart\(new Date\(\), startHour, endHour\)/);
  assert.doesNotMatch(jobs, /now\.getHours\(\)/, 'no server-local hour');
});

test('customer review request default copy: placeholders filled, one link, opt-out line, no Markdown leftovers', () => {
  const link = 'https://app.example/api/campaigns/track/abc123';
  for (const tpl of [REVIEW_REQUEST_INITIAL_DEFAULT, REVIEW_REMINDER_1_DEFAULT, REVIEW_REMINDER_2_DEFAULT]) {
    const msg = tpl.replace(/\{\{\s*name\s*\}\}/g, 'Asha').replace(/\{\{\s*service\s*\}\}/g, 'visit').replace(/\{\{\s*business\s*\}\}/g, 'Mulsetu').replace(/\{\{\s*link\s*\}\}/g, link);
    assert.doesNotMatch(msg, /\{\{|\}\}|\*\*/);
    assert.equal(msg.split(link).length, 2, 'link exactly once');
    assert.match(msg, /\nReply STOP to opt out\.$/);
    assert.doesNotMatch(msg, /\n\n\n|last bother/);
    assert.doesNotMatch(msg, /thank you for (your|the) review|review (was )?(posted|received)/i, 'never claims a review was submitted');
    assert.ok(msg.length < 400);
  }
});

test('weekly update copy carries the summary, a link and the sign-off', () => {
  const t = composeWeeklyWhatsApp({ whatsappText: 'Here is your weekly Growwmatics update:\n\n• New reviews: 2' }, 'Mulsetu', 'https://app.example/dashboard');
  assert.match(t, /^Hi Mulsetu,/);
  assert.match(t, /View your dashboard: https:\/\/app\.example\/dashboard/);
  assert.match(composeWeeklyWhatsApp({ whatsappText: 'x' }, 'M', null), /Open your Growwmatics dashboard/);
});

test('notification template fallback: no doubled greeting, name from the greeting, one line', () => {
  const owner = composeOwnerMessage({ name: 'Mulsetu', body: 'Some reviews need a reply.', linkLabel: 'View reviews', link: 'https://x.test/r', noLinkText: '' });
  const t = notificationBodyForTemplate(owner);
  assert.equal(t.name, 'Mulsetu');
  assert.equal(t.text, 'Some reviews need a reply. View reviews: https://x.test/r');
  const inline = notificationBodyForTemplate('Hi Rahul 👋 Just checking in on your audit.\n\nReply anytime.');
  assert.equal(inline.name, 'Rahul');
  assert.equal(inline.text, 'Just checking in on your audit. Reply anytime.');
  const plain = notificationBodyForTemplate('Your GrowwMatics demo is confirmed for Monday.\n\nJoin here: https://meet.test/x');
  assert.equal(plain.name, '');
  assert.equal(plain.text, 'Your GrowwMatics demo is confirmed for Monday. Join here: https://meet.test/x');
  // Only a leading greeting is removed — the rest of a sentence stays.
  const sentence = notificationBodyForTemplate('Hi there, your report is ready.\nOpen it today.');
  assert.equal(sentence.text, 'your report is ready. Open it today.');
  assert.equal(notificationBodyForTemplate('Hello world is our slogan.\nNext line').text, 'Hello world is our slogan. Next line');
});

test('invalid template variables are refused before any Twilio call', () => {
  assert.match(String(unsafeTemplateVariableReason({ '1': 'Ok', '2': 'two\nlines' })), /single line/);
  assert.match(String(unsafeTemplateVariableReason({ '1': '' })), /empty/);
  assert.match(String(unsafeTemplateVariableReason({ '1': 'a     b' })), /consecutive spaces/);
  assert.match(String(unsafeTemplateVariableReason({ '1': 'x'.repeat(1025) })), /longer than/);
  assert.equal(unsafeTemplateVariableReason({ '1': 'Rahul', '2': 'Fine text' }), null);
  const tooLong = buildNotificationVariables('Rahul', 'x'.repeat(NOTIFICATION_BODY_MAX + 1));
  assert.equal(tooLong.ok, false);
});

test('customer review request: the same template goes out at most twice per request', () => {
  assert.equal(MAX_IDENTICAL_REVIEW_TEMPLATE_SENDS, 2);
  const sid = 'HXutility';
  assert.equal(identicalReviewTemplateCapReached([{ templateSid: sid, status: 'Read' }], sid), false);
  assert.equal(identicalReviewTemplateCapReached([{ templateSid: sid, status: 'Delivered' }, { templateSid: sid, status: 'Sent' }], sid), true);
  assert.equal(identicalReviewTemplateCapReached([{ templateSid: sid, status: 'Read' }, { templateSid: sid, status: 'Failed' }], sid), false, 'a failed send is not a delivered copy');
  assert.equal(identicalReviewTemplateCapReached([{ templateSid: sid }, { templateSid: sid }], ''), false, 'free-text reminders are not capped here');
  const jobs = src('services/inngest/functions.ts');
  assert.match(jobs, /identicalReviewTemplateCapReached\(req\?\.messageHistory, nextTemplateSid\)/);
});

test('payment: one WhatsApp per charge from billingWhatsApp — no invoice/welcome templates, none from activation itself', () => {
  const activation = src('services/billing/customerActivation.ts');
  assert.doesNotMatch(activation, /sendTemplateMessage|WA_TEMPLATES/);
  const entitlements = src('lib/billing/applyEntitlements.ts');
  assert.doesNotMatch(entitlements, /event: 'billing_activated'/, 'activation sends no WhatsApp itself (Segment 2)');
  assert.match(src('services/billing/billingEvents.ts'), /await notifyPaymentConfirmed\(\{/);
  // The payment-failure reminder sequence is untouched (still off unless a super admin enables it).
  assert.match(entitlements, /if \(!\(await getReminderPolicy\(\)\)\.enabled\)/);
});

test('one report notice per report; a WhatsApp-connected report is not announced twice', () => {
  const notify = src('services/lifecycle/notify.ts');
  assert.match(notify, /status: 'COMPLETED', ownerNotifiedAt: \{ \$exists: false \}/);
  // Claimed before anything is sent; a lost claim sends nothing.
  assert.match(notify, /const claimed = await claimReportOwnerNotice\(auditId\);\s+[^\n]*\n\s+await clearPendingMonthlyNotice\(businessId, auditId\);\s+if \(!claimed\) return;/);
  const jobs = src('services/inngest/functions.ts');
  assert.match(jobs, /if \(kind !== 'connected_baseline'\) return/);
  assert.match(jobs, /ReportConversation\.exists\(\{ auditId: audit\._id \}\)/);
});

test('a website-form line is not WhatsApp consent', () => {
  assert.match(src('lib/whatsappConsent.ts'), /role: 'lead', via: \{ \$ne: 'form' \}/);
});
