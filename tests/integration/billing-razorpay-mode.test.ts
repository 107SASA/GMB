/**
 * Razorpay test/live isolation — pure rules (no DB, no Razorpay).
 * Run: node --experimental-strip-types --test tests/integration/billing-razorpay-mode.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { razorpayModeFromKeyId, savedModeUsable, isPlanIdUsable, recordedSubscriptionMode, recordedInOtherMode, subscriptionModeVerdict } from '../../src/lib/billing/razorpayMode.ts';
import { recordedCheckoutMode, retirePreviousCheckout, type PreviousCheckoutState } from '../../src/lib/billing/checkoutGuard.ts';

test('mode comes only from a recognised key id prefix', () => {
  assert.equal(razorpayModeFromKeyId('rzp_test_abc'), 'test');
  assert.equal(razorpayModeFromKeyId('rzp_live_abc'), 'live');
  assert.equal(razorpayModeFromKeyId(' rzp_live_abc '), 'live');
  for (const bad of [undefined, null, '', 'abc', 'rzp_abc', 'RZP_LIVE_abc', 42]) assert.equal(razorpayModeFromKeyId(bad), null, String(bad));
});

test('plan id: test id rejected under live, live id rejected under test, same mode + price accepted', () => {
  const testPlan = { planId: 'plan_t', planPriceInr: 9999, planMode: 'test' };
  const livePlan = { planId: 'plan_l', planPriceInr: 9999, planMode: 'live' };
  assert.equal(isPlanIdUsable(testPlan, { priceInr: 9999, mode: 'live' }), false);
  assert.equal(isPlanIdUsable(livePlan, { priceInr: 9999, mode: 'test' }), false);
  assert.equal(isPlanIdUsable(testPlan, { priceInr: 9999, mode: 'test' }), true);
  assert.equal(isPlanIdUsable(livePlan, { priceInr: 9999, mode: 'live' }), true);
  assert.equal(isPlanIdUsable(livePlan, { priceInr: 10999, mode: 'live' }), false, 'price changed');
  assert.equal(isPlanIdUsable(livePlan, { priceInr: 9999, mode: null }), false, 'billing not configured');
});

test('legacy plan id (no recorded mode): test only, never reused under live keys', () => {
  const legacy = { planId: 'plan_old', planPriceInr: 1999 };
  assert.equal(isPlanIdUsable(legacy, { priceInr: 1999, mode: 'test' }), true);
  assert.equal(isPlanIdUsable(legacy, { priceInr: 1999, mode: 'live' }), false);
  assert.equal(savedModeUsable(undefined, 'live'), false);
  assert.equal(savedModeUsable('', 'live'), false);
  assert.equal(savedModeUsable(undefined, 'test'), true);
});

// ── checkout guard ──────────────────────────────────────────────────────────
function fakeRazorpay(states: Array<PreviousCheckoutState | Error>) {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    deps: {
      fetchSubscription: async (id: string) => {
        calls.push(`fetch:${id}`);
        const s = states[Math.min(i++, states.length - 1)];
        if (s instanceof Error) throw s;
        return s;
      },
      cancelSubscription: async (id: string) => {
        calls.push(`cancel:${id}`);
      },
    },
  };
}

test('recorded mode applies only to the exact checkout id it names', () => {
  const ws = { razorpaySubscriptionEnv: { subscriptionId: 'sub_a', mode: 'test' } };
  assert.equal(recordedCheckoutMode(ws, 'sub_a'), 'test');
  assert.equal(recordedCheckoutMode(ws, 'sub_b'), null, 'a newer id written elsewhere is unknown');
  assert.equal(recordedCheckoutMode({}, 'sub_a'), null, 'legacy: nothing recorded');
  assert.equal(recordedCheckoutMode({ razorpaySubscriptionEnv: { subscriptionId: 'sub_a', mode: 'other' } }, 'sub_a'), null);
  assert.equal(recordedCheckoutMode(ws, null), null);
});

test('proven test-mode checkout under live keys does not block a live checkout (not fetched, not cancelled)', async () => {
  const rp = fakeRazorpay([new Error('The id provided does not exist')]);
  const r = await retirePreviousCheckout(rp.deps, 'sub_test', { previousMode: 'test', currentMode: 'live' });
  assert.deepEqual(r, { kind: 'test_checkout_ignored', subscriptionId: 'sub_test' });
  assert.deepEqual(rp.calls, [], 'Razorpay never contacted; the test subscription is left untouched');
});

test('unknown mode, lookup failure, live → test and possibly-active live checkouts stay blocked', async () => {
  const notFound = new Error('The id provided does not exist');
  // Legacy checkout (no recorded mode) under live keys: lookup fails → refused, nothing created.
  assert.equal((await retirePreviousCheckout(fakeRazorpay([notFound]).deps, 'sub_x', { previousMode: null, currentMode: 'live' })).kind, 'unavailable');
  // Live checkout while test keys are configured: never assumed harmless.
  assert.equal((await retirePreviousCheckout(fakeRazorpay([notFound]).deps, 'sub_x', { previousMode: 'live', currentMode: 'test' })).kind, 'unavailable');
  // Same-mode lookup failure.
  assert.equal((await retirePreviousCheckout(fakeRazorpay([new Error('timeout')]).deps, 'sub_x', { previousMode: 'live', currentMode: 'live' })).kind, 'unavailable');
  // Live checkout that may be paying right now.
  for (const status of ['authenticated', 'active', 'pending']) {
    const rp = fakeRazorpay([{ status, paidCount: 0 }]);
    assert.equal((await retirePreviousCheckout(rp.deps, 'sub_x', { previousMode: 'live', currentMode: 'live' })).kind, 'payment_in_progress', status);
    assert.ok(!rp.calls.some((c) => c.startsWith('cancel:')), `${status}: never cancelled`);
  }
  // Billing not configured (no current mode): no shortcut either.
  assert.equal((await retirePreviousCheckout(fakeRazorpay([notFound]).deps, 'sub_x', { previousMode: 'test', currentMode: null })).kind, 'unavailable');
});

test('test → test keeps the normal Razorpay checks (no shortcut within one mode)', async () => {
  const rp = fakeRazorpay([{ status: 'created', paidCount: 0 }, { status: 'cancelled', paidCount: 0 }]);
  assert.deepEqual(await retirePreviousCheckout(rp.deps, 'sub_t', { previousMode: 'test', currentMode: 'test' }), { kind: 'cancelled_previous', subscriptionId: 'sub_t' });
  assert.deepEqual(rp.calls, ['fetch:sub_t', 'cancel:sub_t', 'fetch:sub_t']);
});

test('recorded subscription mode: only from a record naming that exact id; disagreement or absence → unknown', () => {
  const ws = {
    billingSubscriptionEnv: { subscriptionId: 'sub_pay', mode: 'test' },
    razorpaySubscriptionEnv: { subscriptionId: 'sub_link', mode: 'live' },
    recoveryCheckout: { subscriptionId: 'sub_rec', mode: 'live' },
  };
  assert.equal(recordedSubscriptionMode(ws, 'sub_pay'), 'test');
  assert.equal(recordedSubscriptionMode(ws, 'sub_link'), 'live');
  assert.equal(recordedSubscriptionMode(ws, 'sub_rec'), 'live');
  assert.equal(recordedSubscriptionMode(ws, 'sub_other'), null, 'nothing names it → unknown (never inferred)');
  assert.equal(recordedSubscriptionMode({}, 'sub_pay'), null);
  assert.equal(recordedSubscriptionMode(null, 'sub_pay'), null);
  assert.equal(
    recordedSubscriptionMode({ billingSubscriptionEnv: { subscriptionId: 'sub_x', mode: 'test' }, razorpaySubscriptionEnv: { subscriptionId: 'sub_x', mode: 'live' } }, 'sub_x'),
    null,
    'conflicting records → unknown'
  );
  assert.equal(recordedSubscriptionMode({ recoveryCheckout: { subscriptionId: 'sub_r', mode: 'bogus' } }, 'sub_r'), null);

  assert.equal(recordedInOtherMode('test', 'live'), true);
  assert.equal(recordedInOtherMode('live', 'test'), true);
  assert.equal(recordedInOtherMode('live', 'live'), false);
  assert.equal(recordedInOtherMode(null, 'live'), false, 'unknown is not "other mode" — it stays on the fail-closed path');
  assert.equal(recordedInOtherMode('test', null), false);
});

test('webhook mode verdict: matching / conflicting records / none naming the id — never inferred', () => {
  const recs = [
    { subscriptionId: 'sub_a', mode: 'live' },
    { subscriptionId: 'sub_a', mode: 'live' },
    { subscriptionId: 'sub_b', mode: 'test' },
    null,
    undefined,
  ];
  assert.equal(subscriptionModeVerdict(recs, 'sub_a'), 'live', 'all records naming it agree');
  assert.equal(subscriptionModeVerdict(recs, 'sub_b'), 'test');
  assert.equal(subscriptionModeVerdict(recs, 'sub_c'), null, 'nothing names it → missing (null)');
  assert.equal(subscriptionModeVerdict([{ subscriptionId: 'sub_x', mode: 'test' }, { subscriptionId: 'sub_x', mode: 'live' }], 'sub_x'), 'ambiguous');
  assert.equal(subscriptionModeVerdict([{ subscriptionId: 'sub_x', mode: 'bogus' }], 'sub_x'), null, 'invalid mode values are not a record');
  assert.equal(subscriptionModeVerdict(recs, null), null, 'no subscription id → nothing to decide');
});
