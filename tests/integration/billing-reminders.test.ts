/**
 * Payment-recovery reminders + safe recovery decisions — pure rules, fixed clock.
 * Run: node --experimental-strip-types --test tests/integration/billing-reminders.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REMINDER_POLICY,
  parseReminderPolicy,
  validateReminderPolicyUpdate,
  templateUsable,
} from '../../src/lib/billing/billingPolicy.ts';
import {
  planReminderSteps,
  isWithinSendingHours,
  nextSendingWindow,
  classifySendResult,
  stepsToSkip,
} from '../../src/lib/billing/recoveryReminders.ts';
import { decideOriginal, decideAfterCancel } from '../../src/lib/billing/paymentRecovery.ts';
import { decideBillingEvent } from '../../src/lib/billing/subscriptionMachine.ts';

const SID = 'HX' + 'a'.repeat(32);
const VALID = {
  enabled: true,
  steps: [{ offsetDays: 0 }, { offsetDays: 1 }, { offsetDays: 2 }, { offsetDays: 7 }],
  maxReminders: 4,
  sendingHours: { start: 9, end: 20 },
  timezone: 'Asia/Kolkata',
  retry: { maxAttempts: 3, backoffMinutes: 30 },
  template: { contentSid: SID, approved: true },
  finalTemplate: null,
};
const DAY = 86_400_000;
// 10:00 IST = 04:30 UTC
const T0 = new Date('2027-01-15T04:30:00.000Z');

test('defaults: OFF, Day 0/1/2/7, max 4, 09–20 IST, 3 attempts / 30 min, no template', () => {
  assert.equal(DEFAULT_REMINDER_POLICY.enabled, false);
  assert.deepEqual(DEFAULT_REMINDER_POLICY.steps.map((s) => s.offsetDays), [0, 1, 2, 7]);
  assert.equal(DEFAULT_REMINDER_POLICY.maxReminders, 4);
  assert.deepEqual(DEFAULT_REMINDER_POLICY.sendingHours, { start: 9, end: 20 });
  assert.equal(DEFAULT_REMINDER_POLICY.timezone, 'Asia/Kolkata');
  assert.deepEqual(DEFAULT_REMINDER_POLICY.retry, { maxAttempts: 3, backoffMinutes: 30 });
  assert.equal(templateUsable(DEFAULT_REMINDER_POLICY.template), false);
  assert.deepEqual(parseReminderPolicy(null), DEFAULT_REMINDER_POLICY);
});

test('reminders can never be on without an approved template (stored or submitted)', () => {
  assert.equal(parseReminderPolicy({ reminders: { ...VALID, template: { contentSid: '', approved: true } } }).enabled, false);
  assert.equal(parseReminderPolicy({ reminders: { ...VALID, template: { contentSid: SID, approved: false } } }).enabled, false);
  assert.equal(parseReminderPolicy({ reminders: { ...VALID, template: { contentSid: 'not-a-sid', approved: true } } }).enabled, false);
  assert.equal(parseReminderPolicy({ reminders: VALID }).enabled, true);
  assert.equal(validateReminderPolicyUpdate({ ...VALID, template: { contentSid: SID, approved: false } }).ok, false);
});

test('malformed stored parts fall back to defaults', () => {
  const p = parseReminderPolicy({ reminders: { ...VALID, steps: [{ offsetDays: 1 }, { offsetDays: 1 }], timezone: 'Mars/Base', sendingHours: { start: 20, end: 9 }, retry: { maxAttempts: 99 } } });
  assert.deepEqual(p.steps, DEFAULT_REMINDER_POLICY.steps);
  assert.equal(p.timezone, 'Asia/Kolkata');
  assert.deepEqual(p.sendingHours, DEFAULT_REMINDER_POLICY.sendingHours);
  assert.deepEqual(p.retry, DEFAULT_REMINDER_POLICY.retry);
});

test('admin updates are validated; steps can be added, removed and reordered', () => {
  const reordered = validateReminderPolicyUpdate({ ...VALID, steps: [{ offsetDays: 7 }, { offsetDays: 0 }, { offsetDays: 3 }] });
  assert.equal(reordered.ok, true);
  assert.deepEqual((reordered as any).value.steps.map((s: any) => s.offsetDays), [0, 3, 7]);
  const bad: unknown[] = [
    null,
    { ...VALID, enabled: 'yes' },
    { ...VALID, steps: [] },
    { ...VALID, steps: Array.from({ length: 11 }, (_, i) => ({ offsetDays: i })) },
    { ...VALID, steps: [{ offsetDays: 0 }, { offsetDays: 0 }] },
    { ...VALID, steps: [{ offsetDays: 61 }] },
    { ...VALID, steps: [{ offsetDays: 1.5 }] },
    { ...VALID, maxReminders: 0 },
    { ...VALID, sendingHours: { start: 21, end: 9 } },
    { ...VALID, timezone: 'Nowhere/City' },
    { ...VALID, retry: { maxAttempts: 9, backoffMinutes: 30 } },
    { ...VALID, retry: { maxAttempts: 3, backoffMinutes: 1 } },
    { ...VALID, template: { contentSid: 'HX123', approved: true } },
    { ...VALID, finalTemplate: { contentSid: SID, approved: false } },
  ];
  for (const b of bad) assert.equal(validateReminderPolicyUpdate(b).ok, false, JSON.stringify(b));
});

test('schedule is frozen at Day 0: exactly Day 0, 1, 2, 7 — capped by maxReminders', () => {
  const steps = planReminderSteps(T0, VALID);
  assert.deepEqual(steps.map((s) => [s.key, s.dueAt.toISOString(), s.final]), [
    ['d0', T0.toISOString(), false],
    ['d1', new Date(T0.getTime() + DAY).toISOString(), false],
    ['d2', new Date(T0.getTime() + 2 * DAY).toISOString(), false],
    ['d7', new Date(T0.getTime() + 7 * DAY).toISOString(), true],
  ]);
  assert.deepEqual(planReminderSteps(T0, { ...VALID, maxReminders: 2 }).map((s) => s.key), ['d0', 'd1']);
});

test('sending hours are evaluated in the configured timezone', () => {
  const ist = (h: number, m = 0) => new Date(Date.UTC(2027, 0, 15, h, m) - 5.5 * 3_600_000);
  assert.equal(isWithinSendingHours(ist(8, 59), VALID.sendingHours, 'Asia/Kolkata'), false);
  assert.equal(isWithinSendingHours(ist(9, 0), VALID.sendingHours, 'Asia/Kolkata'), true);
  assert.equal(isWithinSendingHours(ist(19, 59), VALID.sendingHours, 'Asia/Kolkata'), true);
  assert.equal(isWithinSendingHours(ist(20, 0), VALID.sendingHours, 'Asia/Kolkata'), false);
  assert.equal(nextSendingWindow(ist(21, 15), VALID.sendingHours, 'Asia/Kolkata').toISOString(), new Date(ist(9, 0).getTime() + DAY).toISOString());
  assert.equal(nextSendingWindow(ist(6, 0), VALID.sendingHours, 'Asia/Kolkata').toISOString(), ist(9, 0).toISOString());
});

test('send outcomes: only explicit rate limits retry; anything ambiguous is never resent', () => {
  assert.equal(classifySendResult({ success: true, sid: 'SM1' }), 'sent');
  assert.equal(classifySendResult({ success: true }), 'ambiguous');
  assert.equal(classifySendResult({ success: false, errorCode: '20429', error: 'Too many requests' }), 'retry');
  assert.equal(classifySendResult({ success: false, errorCode: '21211', error: 'Invalid To' }), 'failed');
  assert.equal(classifySendResult({ success: false, errorCode: '21656', error: 'ContentVariables invalid' }), 'failed');
  assert.equal(classifySendResult({ success: false, error: 'Request timed out after 15000ms' }), 'ambiguous');
  assert.equal(classifySendResult({ success: false, error: 'read ECONNRESET' }), 'ambiguous');
  assert.equal(classifySendResult({ success: false, error: 'WhatsApp is not configured (missing Twilio credentials)' }), 'failed');
});

test('after an outage only the newest due reminder is sent (no burst)', () => {
  const steps = planReminderSteps(T0, VALID).map((s) => ({ ...s }));
  assert.deepEqual(stepsToSkip(steps, new Date(T0.getTime() + 7 * DAY + 3_600_000)), ['d0', 'd1', 'd2']);
  assert.deepEqual(stepsToSkip(steps, T0), []);
});

test('recovery: what to do with the original subscription, from Razorpay', () => {
  assert.equal(decideOriginal({ status: 'active', paidCount: 4 }), 'already_paid');
  for (const s of ['pending', 'halted', 'authenticated', 'created', 'paused']) assert.equal(decideOriginal({ status: s, paidCount: 1 }), 'cancel_then_verify', s);
  for (const s of ['cancelled', 'completed', 'expired']) assert.equal(decideOriginal({ status: s, paidCount: 1 }), 'cannot_charge', s);
  assert.equal(decideOriginal({ status: 'something_new', paidCount: 1 }), 'unknown');
  assert.equal(decideAfterCancel({ status: 'pending', paidCount: 1 }, { status: 'cancelled', paidCount: 1 }), 'proceed');
  assert.equal(decideAfterCancel({ status: 'pending', paidCount: 1 }, { status: 'cancelled', paidCount: 2 }), 'already_paid');
  assert.equal(decideAfterCancel({ status: 'pending', paidCount: 1 }, { status: 'active', paidCount: 1 }), 'already_paid');
  assert.equal(decideAfterCancel({ status: 'pending', paidCount: 1 }, { status: 'pending', paidCount: 1 }), 'unconfirmed');
});

test('a superseded original: its failure and cancellation are ignored, a late charge on it still counts', () => {
  const ws = { id: 'w', subscriptionStatus: 'past_due', billingSubscriptionId: 'sub_old', razorpaySubscriptionId: 'sub_new', trialEndsAt: null, trialCancelledAt: null, billingLastEventAt: null, supersededSubscriptionIds: ['sub_old'] };
  const sub = (status: string, paidCount = 2) => ({ id: 'sub_old', status, planId: 'p', startAt: null, currentEnd: 1_900_000_000, paidCount, isTrial: false });
  const base = { eventAt: new Date(), payment: null, workspace: ws, claim: null, expectedPaidAmountPaise: null };
  assert.deepEqual(decideBillingEvent({ ...base, type: 'subscription.cancelled', sub: sub('cancelled') }).actions, []);
  assert.deepEqual(decideBillingEvent({ ...base, type: 'subscription.halted', sub: sub('halted') }).actions, []);
  const charged = decideBillingEvent({ ...base, type: 'subscription.charged', sub: sub('active', 3), payment: { amount: 499_900, currency: 'INR', status: 'captured' } });
  assert.deepEqual(charged.actions.map((a) => a.kind), ['activate_paid']);
});
