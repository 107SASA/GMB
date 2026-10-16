/**
 * Super-admin subscription monitoring — status derivation and redaction. Pure.
 * Run: node --experimental-strip-types --test tests/integration/billing-monitoring.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maskPhone,
  maskEmail,
  monitorStatus,
  nextBillingDate,
  buildMonitoringRow,
} from '../../src/lib/billing/monitoring.ts';

const NOW = new Date('2027-01-20T00:00:00.000Z');
const later = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

test('contact details are masked; shadow placeholder emails are hidden', () => {
  assert.equal(maskPhone('+919876543210'), '+••••••••3210');
  assert.equal(maskPhone(null), null);
  assert.equal(maskEmail('asha.baker@example.com'), 'a••••••@example.com');
  assert.equal(maskEmail('919876543210@shadow.growwmatics.internal'), null);
  assert.equal(maskEmail('nope'), null);
});

test('every billing state maps to one monitor status', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ subscriptionStatus: 'active' }, 'paid'],
    [{ subscriptionStatus: 'active', paymentAccessHold: true }, 'held'],
    [{ subscriptionStatus: 'trial_active', trialEndsAt: later(30) }, 'trial'],
    [{ subscriptionStatus: 'trial_active', trialEndsAt: later(30), trialCancelledAt: NOW }, 'trial_cancelled'],
    [{ subscriptionStatus: 'past_due', paymentGraceEndsAt: later(2) }, 'past_due_grace'],
    [{ subscriptionStatus: 'past_due', paymentGraceEndsAt: later(-1) }, 'past_due_restricted'],
    [{ subscriptionStatus: 'past_due' }, 'past_due_restricted'],
    [{ subscriptionStatus: 'canceled' }, 'cancelled'],
    [{ subscriptionStatus: 'trialing' }, 'never_paid'],
    [{}, 'never_paid'],
  ];
  for (const [ws, expected] of cases) assert.equal(monitorStatus(ws, NOW), expected, JSON.stringify(ws));
});

test('next billing date: trial end, renewal date, none when cancelled', () => {
  assert.equal(nextBillingDate({ subscriptionStatus: 'trial_active', trialEndsAt: later(10) })?.toISOString(), later(10).toISOString());
  assert.equal(nextBillingDate({ subscriptionStatus: 'trial_active', trialEndsAt: later(10), trialCancelledAt: NOW }), null);
  assert.equal(nextBillingDate({ subscriptionStatus: 'active', subscriptionCurrentPeriodEnd: later(20) })?.toISOString(), later(20).toISOString());
  assert.equal(nextBillingDate({ subscriptionStatus: 'active', subscriptionCurrentPeriodEnd: later(20), subscriptionCancelAtPeriodEnd: true }), null);
  assert.equal(nextBillingDate({ subscriptionStatus: 'past_due' }), null);
});

test('a monitoring row carries the operational fields and no sensitive data', () => {
  const row = buildMonitoringRow({
    now: NOW,
    business: {
      _id: 'b1', name: 'Asha Bakery', subscriptionStatus: 'past_due', billingSubscriptionId: 'sub_1',
      paymentFailedAt: later(-5), paymentFailureKind: 'renewal', paymentGraceEndsAt: later(-2), paymentRestrictedModules: ['content_studio'],
      recoveryCheckout: { subscriptionId: 'sub_2', expiresAt: later(-1) }, supersededSubscriptionIds: ['sub_1'],
      // Fields that must never leak through the row:
      integrations: { twilioAuthToken: 'secret-token-123' }, googleTokens: { refresh: 'refresh-xyz' },
    },
    owner: { _id: 'u1', fullName: 'Asha', phone: '+919876543210', email: 'asha@example.com', isPhoneVerified: true, subscriptionPlan: 'Pro', passwordHash: 'hash!' },
    episode: { status: 'open', remindersSent: 2, steps: [{ key: 'd0', status: 'sent', attempts: 1, sentAt: later(-5), deliveryStatus: 'read' }, { key: 'd7', status: 'pending', attempts: 0, nextAttemptAt: later(2) }] },
    lastCharge: { amountPaise: 499_900, currency: 'INR', eventAt: later(-35) },
    lastRazorpayEvent: { eventType: 'subscription.pending', eventAt: later(-5) },
  });
  assert.equal(row.status, 'past_due_restricted');
  assert.deepEqual(row.payment.restrictedModules, ['content_studio']);
  assert.equal(row.recovery.openCheckout?.expired, true);
  assert.equal(row.lastChargeInr, 4999);
  assert.equal(row.reminders?.sent, 2);
  assert.equal(row.reminders?.lastDelivery?.delivery, 'read');
  assert.equal(row.owner?.phone, '+••••••••3210');
  const json = JSON.stringify(row);
  for (const secret of ['9876543210', 'asha@example.com', 'secret-token-123', 'refresh-xyz', 'hash!', 'passwordHash', 'card', 'cvv']) {
    assert.ok(!json.includes(secret), `row must not contain "${secret}"`);
  }
});

test('a trial workspace shows the paid plan on trial, not the user record\'s Free', () => {
  const row = buildMonitoringRow({ now: NOW, business: { _id: 'b', subscriptionStatus: 'trial_active', trialEndsAt: later(30) }, owner: { _id: 'u', subscriptionPlan: 'Free' } });
  assert.equal(row.plan, 'Pro (trial)');
});
