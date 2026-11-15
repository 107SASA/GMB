/**
 * Home "Send Review Link" to a number that already got one:
 * 24h gap, max 3 requests per number, owner confirms in between.
 *
 * Run with: node --experimental-strip-types --test tests/integration/review-resend-rule.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideReviewResend, reviewResendBlockedMessage } from '../../src/lib/reviewResendRule.ts';

const now = new Date('2026-11-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

test('a new number is sent without asking', () => {
  assert.equal(decideReviewResend({ sentCount: 0, lastSentAt: null, confirmed: false, now }).kind, 'send');
});

test('within 24 hours a resend is blocked, even when confirmed', () => {
  for (const confirmed of [false, true]) {
    const d = decideReviewResend({ sentCount: 1, lastSentAt: hoursAgo(5), confirmed, now });
    assert.equal(d.kind, 'too-soon');
  }
});

test('after 24 hours the owner is asked, then it sends', () => {
  assert.equal(decideReviewResend({ sentCount: 1, lastSentAt: hoursAgo(25), confirmed: false, now }).kind, 'confirm');
  assert.equal(decideReviewResend({ sentCount: 2, lastSentAt: hoursAgo(24), confirmed: true, now }).kind, 'send');
});

test('after 3 requests no more are sent, even when confirmed', () => {
  const d = decideReviewResend({ sentCount: 3, lastSentAt: hoursAgo(200), confirmed: true, now });
  assert.equal(d.kind, 'limit-reached');
  if (d.kind === 'limit-reached') assert.match(reviewResendBlockedMessage(d), /already sent to this customer 3 times/);
});

test('while automatic reminders are still due, a manual resend is blocked', () => {
  for (const confirmed of [false, true]) {
    const d = decideReviewResend({ sentCount: 1, lastSentAt: hoursAgo(72), followUpsActive: true, confirmed, now });
    assert.equal(d.kind, 'follow-ups-running');
    if (d.kind === 'follow-ups-running') assert.match(reviewResendBlockedMessage(d), /Automatic reminders are still going out/);
  }
});

test('once reminders finish, the owner may resend after confirming', () => {
  assert.equal(decideReviewResend({ sentCount: 1, lastSentAt: hoursAgo(200), followUpsActive: false, confirmed: false, now }).kind, 'confirm');
});

test('a request still marked active after the reminder window no longer blocks', () => {
  assert.equal(decideReviewResend({ sentCount: 1, lastSentAt: hoursAgo(11 * 24), followUpsActive: true, confirmed: false, now }).kind, 'confirm');
});
