/**
 * Segment 1 — sales & nurturing, pure rules (lib/preSalesRules.ts) plus the
 * source-level wiring that has no database to test against.
 * Run: node --experimental-strip-types --test tests/integration/presales-rules.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SALES_FOLLOW_UP_DELAY_MINUTES,
  SALES_FOLLOW_UP_LIMIT,
  SALES_INVITE_MIN_DELAY_MINUTES,
  analysisOutcomeForAttendance,
  attendedFollowUpAllowed,
  confirmedAttendance,
  conversationSalesBlockedReason,
  demoHasEnded,
  demoTimeKey,
  postDemoKindFor,
  statusForAttendance,
  leadPreSalesBlockedReason,
  minutesUntilSalesSendable,
  nurtureSendsEnabled,
  postDemoMessage,
  workspaceStartedTrialOrPaid,
} from '../../src/lib/preSalesRules.ts';
import {
  DEFAULT_FIRST_AI_PROMPT,
  DEFAULT_FIRST_TEMPLATE,
  SEP_2026_FIRST_TEMPLATE,
  upgradeUnmodifiedDefault,
} from '../../src/lib/salesAgentDefaults.ts';

const src = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');

test('limits: one invitation ≥ 2h after the report, one follow-up ~48h later', () => {
  assert.equal(SALES_INVITE_MIN_DELAY_MINUTES, 120);
  assert.equal(SALES_FOLLOW_UP_LIMIT, 1);
  assert.equal(SALES_FOLLOW_UP_DELAY_MINUTES, 48 * 60);
});

test('lead rules: opt-out, not interested, human, customer and a demo in hand block automated sales', () => {
  assert.equal(leadPreSalesBlockedReason(null, 'invite'), null);
  assert.equal(leadPreSalesBlockedReason({ currentAgent: 'SALES', currentStage: 'NURTURING' }, 'follow-up'), null);
  assert.equal(leadPreSalesBlockedReason({ nurtureStatus: 'OPTED_OUT' }, 'invite'), 'opted-out');
  assert.equal(leadPreSalesBlockedReason({ intent: 'NOT_INTERESTED' }, 'follow-up'), 'not-interested');
  assert.equal(leadPreSalesBlockedReason({ currentStage: 'LOST' }, 'invite'), 'stopped');
  assert.equal(leadPreSalesBlockedReason({ humanHandoff: { active: true } }, 'invite'), 'human-owned');
  assert.equal(leadPreSalesBlockedReason({ currentAgent: 'IN_HOUSE' }, 'invite'), 'already-customer');
  assert.equal(leadPreSalesBlockedReason({ currentStage: 'PAYMENT_VERIFIED' }, 'follow-up'), 'already-customer');
  assert.equal(leadPreSalesBlockedReason({ currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED' }, 'follow-up'), 'demo-in-progress');
  assert.equal(leadPreSalesBlockedReason({ intent: 'DEMO_INTEREST' }, 'follow-up'), 'demo-intent-owns-next-step');
  // The post-demo message is about the demo itself — a demo stage doesn't block it, a decline does.
  assert.equal(leadPreSalesBlockedReason({ currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED' }, 'post-demo'), null);
  assert.equal(leadPreSalesBlockedReason({ intent: 'NOT_INTERESTED' }, 'post-demo'), 'not-interested');
});

test('workspace rules: a trial (paid or not) or a payment ends pre-sales; the legacy "trialing" default does not', () => {
  assert.equal(workspaceStartedTrialOrPaid({ subscriptionStatus: 'trialing' }), false);
  assert.equal(workspaceStartedTrialOrPaid(null), false);
  for (const s of ['trial_active', 'active', 'past_due', 'canceled']) assert.equal(workspaceStartedTrialOrPaid({ subscriptionStatus: s }), true, s);
  assert.equal(workspaceStartedTrialOrPaid({ subscriptionStatus: 'trialing', trialStartedAt: new Date() }), true);
  assert.equal(workspaceStartedTrialOrPaid({ subscriptionStatus: 'trialing', billingSubscriptionId: 'sub_1' }), true);
  assert.equal(workspaceStartedTrialOrPaid(null, 'Pro'), true);
  assert.equal(workspaceStartedTrialOrPaid(null, 'Free'), false);
});

test('conversation rules: the sequence ends at the first reply after it started', () => {
  const sent = new Date('2026-10-20T10:00:00Z');
  assert.equal(conversationSalesBlockedReason(null, 'follow-up'), 'conversation-missing');
  assert.equal(conversationSalesBlockedReason({ status: 'handed_off' }, 'follow-up'), 'conversation-handed_off');
  assert.equal(conversationSalesBlockedReason({ status: 'active' }, 'follow-up'), 'no-first-message');
  assert.equal(conversationSalesBlockedReason({ status: 'active', firstSentAt: sent }, 'follow-up'), null);
  assert.equal(conversationSalesBlockedReason({ status: 'active', firstSentAt: sent, lastLeadReplyAt: new Date(sent.getTime() + 60_000) }, 'follow-up'), 'lead-replied');
  // A YES that came before the findings went out is not a reply to them.
  assert.equal(conversationSalesBlockedReason({ status: 'active', firstSentAt: sent, lastLeadReplyAt: new Date(sent.getTime() - 60_000) }, 'follow-up'), null);
  assert.equal(conversationSalesBlockedReason({ status: 'active', consentStatus: 'granted' }, 'invite', 'consent'), 'consent-not-pending');
});

test('quiet hours apply only when switched on — no built-in window — in the configured timezone', () => {
  // 22:30 IST = 17:00 UTC.
  assert.equal(minutesUntilSalesSendable(new Date('2026-10-22T17:00:00Z'), null), 0, 'nothing configured → no restriction');
  assert.equal(minutesUntilSalesSendable(new Date('2026-10-22T17:00:00Z'), { enabled: false, start: '21:00', end: '09:00' }), 0, 'switched off → no restriction');
  assert.equal(minutesUntilSalesSendable(new Date('2026-10-22T17:00:00Z'), { enabled: true, start: '21:00', end: '09:00' }), 630, 'on → wait until 09:00 IST');
  assert.equal(minutesUntilSalesSendable(new Date('2026-10-22T06:00:00Z'), { enabled: true, start: '11:00', end: '12:00' }), 30);
  // Same instant in Dubai (UTC+4) is 21:00 → inside a 20:00–08:00 window there, 11 hours left.
  assert.equal(minutesUntilSalesSendable(new Date('2026-10-22T17:00:00Z'), { enabled: true, start: '20:00', end: '08:00' }, 'Asia/Dubai'), 660);
  assert.equal(minutesUntilSalesSendable(new Date('2026-10-22T17:00:00Z'), { enabled: true, start: '21:00', end: '09:00' }, 'Not/AZone'), 630, 'invalid zone → IST');
});

test('nurturing is its own switch, but never sends while the Sales agent is off', () => {
  assert.equal(nurtureSendsEnabled({ enabled: true, nurtureEnabled: true }), true);
  assert.equal(nurtureSendsEnabled({ enabled: true, nurtureEnabled: false }), false, 'nurture off, live replies still on');
  assert.equal(nurtureSendsEnabled({ enabled: false, nurtureEnabled: true }), false, 'agent off stops everything');
  assert.equal(nurtureSendsEnabled({ enabled: true }), true, 'never saved → follows the agent switch (unchanged behaviour)');
  assert.equal(nurtureSendsEnabled({ enabled: false }), false);
  assert.equal(nurtureSendsEnabled(null), false);
});

test('post-demo copy: attended thanks + next step; missed asks to reschedule; declined / not ready sends nothing', () => {
  const attended = postDemoMessage({ kind: 'attended', name: 'Rahul Sharma', businessName: 'Mulsetu', outcome: 'PRICE_CONCERN', subscribeUrl: 'https://x.test/billing' })!;
  assert.match(attended, /^Hi Rahul, thank you for joining the Growwmatics demo for Mulsetu\./);
  assert.match(attended, /plan and pricing/);
  assert.match(attended, /https:\/\/x\.test\/billing/);
  const missed = postDemoMessage({ kind: 'missed', name: 'Rahul', whenLabel: 'Mon 26 Oct at 4:00 PM' })!;
  assert.match(missed, /sorry we missed you at your Growwmatics demo on Mon 26 Oct at 4:00 PM/);
  assert.match(missed, /Reply RESCHEDULE/);
  assert.doesNotMatch(missed, /thank you for joining/i, 'never claims a missed demo happened');
  assert.equal(postDemoMessage({ kind: 'attended', outcome: 'NOT_INTERESTED' }), null);
  assert.equal(postDemoMessage({ kind: 'attended', outcome: 'NOT_READY' }), null);
});

test('attended follow-up only when attendance is not contradicted', () => {
  assert.equal(attendedFollowUpAllowed(null), true, 'a person marked it Completed; analysis may have failed');
  assert.equal(attendedFollowUpAllowed('HIGH_INTEREST'), true);
  for (const o of ['NOT_INTERESTED', 'NOT_READY', 'NO_SHOW', 'RESCHEDULE_REQUIRED']) assert.equal(attendedFollowUpAllowed(o), false, o);
  assert.equal(postDemoMessage({ kind: 'attended', outcome: 'NO_SHOW' }), null);
});

test('default invitation clearly invites a demo; only unmodified earlier defaults are upgraded', () => {
  assert.match(DEFAULT_FIRST_TEMPLATE, /Would you like a short demo/);
  assert.match(DEFAULT_FIRST_TEMPLATE, /Reply \*DEMO\*/);
  assert.match(DEFAULT_FIRST_AI_PROMPT, /invit\w* them to book a short demo/);
  assert.match(DEFAULT_FIRST_AI_PROMPT, /Never propose a date, time or link/);
  // Exact (whitespace / line-ending insensitive) match → current default.
  assert.equal(upgradeUnmodifiedDefault(SEP_2026_FIRST_TEMPLATE.replace(/\n/g, '\r\n') + '\n', [SEP_2026_FIRST_TEMPLATE], DEFAULT_FIRST_TEMPLATE), DEFAULT_FIRST_TEMPLATE);
  // Any customization → kept exactly as written.
  const custom = SEP_2026_FIRST_TEMPLATE.replace('Want us to walk you through fixing these?', 'Call us on 98xxxx to fix these!');
  assert.equal(upgradeUnmodifiedDefault(custom, [SEP_2026_FIRST_TEMPLATE], DEFAULT_FIRST_TEMPLATE), custom);
  assert.equal(upgradeUnmodifiedDefault(undefined, [SEP_2026_FIRST_TEMPLATE], DEFAULT_FIRST_TEMPLATE), undefined);
});

test('admin screens show the effective follow-up rules and never rewrite stored values for display', () => {
  const salesAdmin = src('app/admin/sales-agent/page.tsx');
  assert.match(salesAdmin, /At most \{SALES_FOLLOW_UP_LIMIT\} follow-up is sent, about \{FOLLOW_UP_HOURS\} hours after the first message/);
  assert.match(salesAdmin, /config\.followUps\.length < SALES_FOLLOW_UP_LIMIT && \(/, 'no "Add follow-up" past the limit');
  assert.match(salesAdmin, /stored value \$\{f\.delayHours\}h is not used/);
  assert.doesNotMatch(salesAdmin, /setFollowUp\(i, \{ delayHours:/, 'the ignored delay is no longer editable');
  assert.doesNotMatch(salesAdmin, /setFollowUp\(i, \{ onlyIfNoReply:/, 'the always-on rule is not a toggle here');
  const nurtureAdmin = src('app/admin/nurture-config/page.tsx');
  assert.match(nurtureAdmin, /<strong>one invitation<\/strong>/);
  assert.match(nurtureAdmin, /<strong>one follow-up<\/strong>/);
  assert.match(nurtureAdmin, /Minimum \{minHours\} hours/);
  assert.match(nurtureAdmin, /When off, there is no time restriction/);
  // Controls the sender never read are gone.
  for (const dead of [/rolloutPercentage/, /leadIdAllowlist/, /minimumMessageGapMinutes/, /maxNurtureMessages/, /onlyIfNoReply/, /Add step/]) {
    assert.doesNotMatch(nurtureAdmin, dead, String(dead));
  }
});

test('wiring: proactive NBA retired, drip capped, every scheduled sales send re-checked', () => {
  const jobs = src('services/inngest/functions.ts');
  const proactive = jobs.slice(jobs.indexOf('export const proactiveNbaScheduler'), jobs.indexOf('export const proactiveNbaScheduler') + 400);
  assert.doesNotMatch(proactive, /ScheduledAction\.create/);
  assert.match(jobs, /action\.reason = 'proactive-nba-retired'/);
  assert.match(jobs, /const limit = Math\.min\(followUpCount, SALES_FOLLOW_UP_LIMIT\)/);
  // The drip and the Nurturing preview share one follow-up check.
  assert.match(jobs, /followUpBlockedReason\(conversationId, i\)/);
  assert.match(src('services/sales/preSalesPolicy.ts'), /preSalesSendBlockedReason\(\{ kind: 'follow-up', conversationId \}\)/);
  assert.match(src('services/nurture/nurtureAdminConfig.ts'), /followUpBlockedReason\(String\(convo\._id\), 0\)/);
  assert.match(jobs, /preSalesSendBlockedReason\(\{ kind: 'invite', step: 'consent', conversationId: prep\.conversationId \}\)/);
  assert.match(jobs, /cancelGenericSalesActions\(salesLead\._id, 'lead-replied'\)/);
  // Trial / payment take the workspace out of pre-sales.
  const billing = src('services/billing/billingEvents.ts');
  assert.match(billing, /stopPreSalesNurtureForWorkspace\(businessId, 'trial-started'\)/);
  assert.match(billing, /stopPreSalesNurtureForWorkspace\(businessId, 'payment-verified'\)/);
  // Only the explicit attendance confirmation can schedule a post-demo message;
  // a status edit and the automatic no-show timeout never do.
  const admin = src('app/api/admin/demo-bookings/route.ts');
  assert.match(admin, /confirmDemoAttendance\(\{ bookingId, outcome: attendance, staffUserId: authResult\.userId \}\)/);
  assert.doesNotMatch(admin, /schedulePostDemoFollowUp/);
  const noShow = jobs.slice(jobs.indexOf('async function runNoShowCheck'), jobs.indexOf('async function recordSentIntoSalesConversation'));
  assert.doesNotMatch(noShow, /schedulePostDemoFollowUp|runPostDemoAnalysis|sendOutboundMessage/);
  assert.match(noShow, /outcome: 'unconfirmed', source: 'auto-timeout'/);
});

test('attendance rules: only a person\'s record for the CURRENT demo time counts', () => {
  const start = new Date('2026-10-20T10:00:00Z');
  const b = (attendance: any, startUtc: Date | null = start) => ({ startUtc, endUtc: startUtc ? new Date(startUtc.getTime() + 30 * 60_000) : null, attendance });
  assert.equal(confirmedAttendance(b({ outcome: 'attended', source: 'staff', forStartUtc: start })), 'attended');
  assert.equal(confirmedAttendance(b({ outcome: 'unconfirmed', source: 'auto-timeout', forStartUtc: start })), null, 'the timeout is not attendance');
  assert.equal(confirmedAttendance(b({ outcome: 'no_show', source: 'auto-timeout', forStartUtc: start })), null);
  assert.equal(confirmedAttendance(b({ outcome: 'attended', source: 'staff', forStartUtc: new Date('2026-10-19T10:00:00Z') })), null, 'stale after a reschedule');
  assert.equal(confirmedAttendance(b(null)), null);
  assert.equal(confirmedAttendance(b({ outcome: 'no_show', source: 'staff' }, null)), 'no_show', 'a booking with no time: unscheduled matches unscheduled');
  assert.equal(postDemoKindFor('attended'), 'attended');
  assert.equal(postDemoKindFor('no_show'), 'missed');
  for (const o of ['declined', 'not_ready', 'unconfirmed', null]) assert.equal(postDemoKindFor(o), null, String(o));
  assert.equal(statusForAttendance('no_show'), 'No Show');
  for (const o of ['attended', 'declined', 'not_ready'] as const) assert.equal(statusForAttendance(o), 'Completed');
  assert.equal(analysisOutcomeForAttendance('declined'), 'NOT_INTERESTED');
  assert.equal(analysisOutcomeForAttendance('not_ready'), 'NOT_READY');
  assert.equal(analysisOutcomeForAttendance('attended'), undefined, 'classified from the conversation');
  assert.equal(demoHasEnded({ endUtc: new Date(Date.now() - 1000) }), true);
  assert.equal(demoHasEnded({ startUtc: new Date(Date.now() - 1000), endUtc: new Date(Date.now() + 60_000) }), false);
  assert.equal(demoHasEnded({}), null, 'no recorded time → cannot confirm');
  assert.equal(demoTimeKey({}), 'unscheduled');
});
