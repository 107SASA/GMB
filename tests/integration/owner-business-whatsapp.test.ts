/**
 * A free-report phone is a sales lead. Business-inner WhatsApp waits until
 * the workspace has subscribed and connected Google.
 *
 * Run: node --experimental-strip-types --test tests/integration/owner-business-whatsapp.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBillingOwnerEvent, ownerBusinessWhatsAppAllowed } from '../../src/services/ownerNotifyEligibility.ts';

const CUSTOMER = {
  subscriptionStatus: 'active',
  googleConnected: true,
  googleLocationId: 'locations/123',
};

test('a free-report lead does not get a critical-review WhatsApp', () => {
  assert.equal(
    ownerBusinessWhatsAppAllowed(
      { subscriptionStatus: 'trialing', googleConnected: true, googleLocationId: null },
      'critical_review',
    ),
    false,
  );
  assert.equal(
    ownerBusinessWhatsAppAllowed(
      { subscriptionStatus: 'trialing', googleConnected: false },
      'critical_review',
    ),
    false,
  );
});

test('a subscribed workspace without a connected Google location does not get inner WhatsApp', () => {
  assert.equal(
    ownerBusinessWhatsAppAllowed(
      { subscriptionStatus: 'active', googleConnected: true, googleLocationId: '' },
      'critical_review',
    ),
    false,
  );
  assert.equal(
    ownerBusinessWhatsAppAllowed(
      { subscriptionStatus: 'active', googleConnected: false, googleLocationId: 'locations/123' },
      'weekly_update',
    ),
    false,
  );
});

test('a subscribed, connected workspace gets the review alert', () => {
  assert.equal(ownerBusinessWhatsAppAllowed(CUSTOMER, 'critical_review'), true);
  assert.equal(ownerBusinessWhatsAppAllowed(CUSTOMER, 'weekly_update'), true);
  assert.equal(ownerBusinessWhatsAppAllowed(CUSTOMER, 'performance_digest'), true);
});

test('a past_due workspace does not get business automation, and still gets billing reminders', () => {
  assert.equal(
    ownerBusinessWhatsAppAllowed({ ...CUSTOMER, subscriptionStatus: 'past_due' }, 'critical_review'),
    false,
  );
  assert.equal(
    ownerBusinessWhatsAppAllowed({ ...CUSTOMER, subscriptionStatus: 'past_due' }, 'weekly_update'),
    false,
  );
  assert.equal(
    ownerBusinessWhatsAppAllowed({ subscriptionStatus: 'past_due', googleConnected: false }, 'billing_past_due'),
    true,
  );
  assert.equal(
    ownerBusinessWhatsAppAllowed({ subscriptionStatus: 'canceled', googleConnected: false }, 'billing_canceled'),
    true,
  );
  assert.equal(isBillingOwnerEvent('billing_activated'), true);
  assert.equal(isBillingOwnerEvent('billing_past_due'), true);
  assert.equal(isBillingOwnerEvent('billing_canceled'), true);
  assert.equal(isBillingOwnerEvent('critical_review'), false);
});

test('billing WhatsApp is not blocked by business notification preferences', () => {
  const notify = readFileSync(new URL('../../src/services/ownerNotify.ts', import.meta.url), 'utf8');
  assert.match(notify, /isBillingOwnerEvent\(input\.event\) && !isOptedIn/);
});

test('content generation does not WhatsApp the customer for buffer or failure alerts', () => {
  const jobs = readFileSync(new URL('../../src/services/inngest/functions.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(jobs, /sendOutboundMessage\(business\.phone/);
  assert.match(jobs, /alert-admin-low-buffer/);
  assert.match(jobs, /alert-admin-generation-failed/);
  assert.match(jobs, /AutomationLog\.create/);
});

test('weekly and 15-day jobs require a real Google location before claiming a slot', () => {
  const lifecycle = readFileSync(new URL('../../src/services/lifecycle/notify.ts', import.meta.url), 'utf8');
  const weekly = lifecycle.slice(lifecycle.indexOf('export async function runWeeklyMonitoringAll'));
  const digest = lifecycle.slice(
    lifecycle.indexOf('export async function runPerformanceDigestAll'),
    lifecycle.indexOf('export async function runWeeklyMonitoringAll'),
  );
  assert.match(weekly, /googleLocationId: \{ \$exists: true, \$nin: \[null, ''\] \}/);
  assert.match(digest, /googleLocationId: \{ \$exists: true, \$nin: \[null, ''\] \}/);
  assert.match(weekly, /subscriptionStatus: 'active'/);
  assert.match(digest, /subscriptionStatus: 'active'/);
});

test('billing notices still send without a Google connection', () => {
  assert.equal(
    ownerBusinessWhatsAppAllowed({ subscriptionStatus: 'trialing', googleConnected: false }, 'billing_activated'),
    true,
  );
});

test('free report does not mark a picked listing as a connected profile, and sales nurture stays', () => {
  const shadow = readFileSync(new URL('../../src/lib/shadowAccount.ts', import.meta.url), 'utf8');
  assert.match(shadow, /googleConnected: false/);
  assert.doesNotMatch(shadow, /googleConnected: !!input\.businessData\.googlePlaceId/);

  const nurture = readFileSync(new URL('../../src/services/inngest/functions.ts', import.meta.url), 'utf8');
  assert.match(nurture, /sales\/nurture\.requested/);
  assert.match(nurture, /sendReportReadyNotification/);
});
