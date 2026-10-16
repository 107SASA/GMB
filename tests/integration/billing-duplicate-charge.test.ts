/**
 * Duplicate-charge prevention and the cancel target — pure rules.
 *  - a second paid subscription for a workspace that is still being charged is
 *    flagged for review, never silently made the paying one (subscriptionMachine.ts);
 *  - checkout retires the previous unpaid checkout before creating another
 *    (checkoutGuard.ts);
 *  - "Cancel subscription" cancels the workspace's PAYING subscription, not the
 *    user-level checkout link (cancelTarget.ts).
 * Run: node --experimental-strip-types --test tests/integration/billing-duplicate-charge.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideBillingEvent, type WorkspaceFacts, type SubscriptionFacts } from '../../src/lib/billing/subscriptionMachine.ts';
import { previousUnpaidCheckout, retirePreviousCheckout, type PreviousCheckoutState } from '../../src/lib/billing/checkoutGuard.ts';
import { cancelTarget, pickCancelWorkspace } from '../../src/lib/billing/cancelTarget.ts';

const T = new Date('2027-03-01T10:00:00Z');
const ws = (over: Partial<WorkspaceFacts> = {}): WorkspaceFacts => ({
  id: 'w1', subscriptionStatus: 'active', billingSubscriptionId: 'sub_a', razorpaySubscriptionId: 'sub_a',
  trialEndsAt: null, trialCancelledAt: null, billingLastEventAt: null, supersededSubscriptionIds: [], ...over,
});
const sub = (id: string, over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  id, status: 'active', planId: 'plan_m', startAt: null, currentEnd: Math.floor(T.getTime() / 1000) + 30 * 86400, paidCount: 1, isTrial: false, ...over,
});
const charged = (workspace: WorkspaceFacts, s: SubscriptionFacts, type = 'subscription.charged') =>
  decideBillingEvent({ type, eventAt: T, sub: s, payment: { amount: 499900, currency: 'INR', status: 'captured' }, workspace, claim: null, expectedPaidAmountPaise: 499900 });
const kinds = (d: ReturnType<typeof charged>) => d.actions.map((a) => a.kind);

// ── state machine ─────────────────────────────────────────────────────────

test('a second paid subscription while the first still charges → flagged for review, not activated', () => {
  for (const type of ['subscription.activated', 'subscription.charged']) {
    const d = charged(ws(), sub('sub_b'), type);
    assert.deepEqual(kinds(d), ['flag_duplicate_subscription'], type);
    assert.match(d.note, /double charge/);
  }
});

test('the paying subscription keeps renewing normally', () => {
  assert.deepEqual(kinds(charged(ws(), sub('sub_a'))), ['activate_paid']);
});

test('resubscribing after cancel-at-period-end is preserved (the old one will not charge again)', () => {
  assert.deepEqual(kinds(charged(ws({ subscriptionCancelAtPeriodEnd: true }), sub('sub_b'))), ['activate_paid']);
});

test('a paid subscription during a running (not cancelled) trial → flagged; after a cancelled trial → activated', () => {
  const trial = { subscriptionStatus: 'trial_active', billingSubscriptionId: 'sub_trial', razorpaySubscriptionId: 'sub_trial', trialEndsAt: new Date('2027-06-01') };
  assert.deepEqual(kinds(charged(ws(trial), sub('sub_b'))), ['flag_duplicate_subscription']);
  assert.deepEqual(kinds(charged(ws({ ...trial, trialCancelledAt: T }), sub('sub_b'))), ['activate_paid']);
});

test('a superseded original charged after its replacement already pays → flagged (customer paid twice)', () => {
  const live = ws({ billingSubscriptionId: 'sub_new', razorpaySubscriptionId: 'sub_new', supersededSubscriptionIds: ['sub_old'] });
  assert.deepEqual(kinds(charged(live, sub('sub_old'))), ['flag_duplicate_subscription']);
});

test('recovery and legacy paths are unchanged', () => {
  // past_due: a late charge on the superseded original still restores access.
  const pastDue = ws({ subscriptionStatus: 'past_due', billingSubscriptionId: 'sub_old', razorpaySubscriptionId: 'sub_new', supersededSubscriptionIds: ['sub_old'] });
  assert.deepEqual(kinds(charged(pastDue, sub('sub_old'))), ['activate_paid']);
  // past_due: the recovery replacement activates.
  assert.deepEqual(kinds(charged(pastDue, sub('sub_new'))), ['activate_paid']);
  // never paid / cancelled workspaces activate as before.
  assert.deepEqual(kinds(charged(ws({ subscriptionStatus: 'trialing', billingSubscriptionId: null, razorpaySubscriptionId: 'sub_b' }), sub('sub_b'))), ['activate_paid']);
  assert.deepEqual(kinds(charged(ws({ subscriptionStatus: 'canceled' }), sub('sub_b'))), ['activate_paid']);
  // legacy paid workspace without billingSubscriptionId keeps the old behaviour.
  assert.deepEqual(kinds(charged(ws({ billingSubscriptionId: null }), sub('sub_b'))), ['activate_paid']);
});

test('the duplicate check never bypasses payment verification', () => {
  const d = decideBillingEvent({ type: 'subscription.charged', eventAt: T, sub: sub('sub_b', { paidCount: 0 }), payment: { amount: 1, currency: 'INR', status: 'failed' }, workspace: ws(), claim: null, expectedPaidAmountPaise: 499900 });
  assert.deepEqual(d.actions, [], 'no captured payment → ignored before the duplicate rule');
});

// ── checkout guard ────────────────────────────────────────────────────────

test('which earlier checkout must be retired', () => {
  assert.equal(previousUnpaidCheckout(null), null);
  assert.equal(previousUnpaidCheckout({ subscriptionStatus: 'trialing' }), null, 'no checkout yet');
  assert.equal(previousUnpaidCheckout({ subscriptionStatus: 'trialing', razorpaySubscriptionId: 'sub_x' }), 'sub_x', 'abandoned or in-flight checkout');
  assert.equal(previousUnpaidCheckout({ subscriptionStatus: 'canceled', razorpaySubscriptionId: 'sub_a', billingSubscriptionId: 'sub_a' }), null, 'the ended paying subscription');
  assert.equal(previousUnpaidCheckout({ subscriptionStatus: 'active', razorpaySubscriptionId: 'sub_y', billingSubscriptionId: 'sub_a' }), 'sub_y', 'unpaid checkout after cancel-at-period-end');
  assert.equal(previousUnpaidCheckout({ subscriptionStatus: 'active', razorpaySubscriptionId: 'sub_legacy' }), null, 'legacy paid link');
});

function fakeRazorpay(states: Array<PreviousCheckoutState | Error>, opts: { cancelThrows?: boolean } = {}) {
  const calls: string[] = [];
  const queue = [...states];
  return {
    calls,
    deps: {
      fetchSubscription: async (id: string) => {
        calls.push(`fetch:${id}`);
        const next = queue.shift();
        if (!next || next instanceof Error) throw next ?? new Error('no state');
        return next;
      },
      cancelSubscription: async (id: string) => {
        calls.push(`cancel:${id}`);
        if (opts.cancelThrows) throw new Error('already authorized');
      },
    },
  };
}

test('never-authorized previous checkout: cancelled, confirmed, then a new one may be created', async () => {
  const rp = fakeRazorpay([{ status: 'created', paidCount: 0 }, { status: 'cancelled', paidCount: 0 }]);
  assert.deepEqual(await retirePreviousCheckout(rp.deps, 'sub_x'), { kind: 'cancelled_previous', subscriptionId: 'sub_x' });
  assert.deepEqual(rp.calls, ['fetch:sub_x', 'cancel:sub_x', 'fetch:sub_x']);
});

test('previous checkout authorized or paid → refuse (no cancel, no second subscription)', async () => {
  for (const state of [{ status: 'authenticated', paidCount: 0 }, { status: 'active', paidCount: 1 }, { status: 'pending', paidCount: 1 }]) {
    const rp = fakeRazorpay([state]);
    const r = await retirePreviousCheckout(rp.deps, 'sub_x');
    assert.equal(r.kind, 'payment_in_progress', state.status);
    assert.deepEqual(rp.calls, ['fetch:sub_x'], 'a paid subscription is never cancelled');
  }
});

test('paid between the cancel and the re-check → refuse, never "cancelled"', async () => {
  const rp = fakeRazorpay([{ status: 'created', paidCount: 0 }, { status: 'active', paidCount: 1 }], { cancelThrows: true });
  assert.equal((await retirePreviousCheckout(rp.deps, 'sub_x')).kind, 'payment_in_progress');
});

test('finished previous subscription (even one paid long ago) does not block a new checkout', async () => {
  for (const status of ['cancelled', 'expired', 'completed']) {
    const rp = fakeRazorpay([{ status, paidCount: 3 }]);
    assert.deepEqual(await retirePreviousCheckout(rp.deps, 'sub_x'), { kind: 'clear' }, status);
    assert.deepEqual(rp.calls, ['fetch:sub_x']);
  }
});

test('any doubt → unavailable (nothing created): unreachable, unknown status, cancel not confirmed', async () => {
  assert.equal((await retirePreviousCheckout(fakeRazorpay([new Error('timeout')]).deps, 'sub_x')).kind, 'unavailable');
  assert.equal((await retirePreviousCheckout(fakeRazorpay([{ status: 'mystery', paidCount: 0 }]).deps, 'sub_x')).kind, 'unavailable');
  assert.equal((await retirePreviousCheckout(fakeRazorpay([{ status: 'created', paidCount: 0 }, { status: 'created', paidCount: 0 }]).deps, 'sub_x')).kind, 'unavailable');
  assert.equal((await retirePreviousCheckout(fakeRazorpay([{ status: 'created', paidCount: 0 }, new Error('down')]).deps, 'sub_x')).kind, 'unavailable');
});

test('no previous checkout → clear without calling Razorpay', async () => {
  const rp = fakeRazorpay([]);
  assert.deepEqual(await retirePreviousCheckout(rp.deps, null), { kind: 'clear' });
  assert.deepEqual(rp.calls, []);
});

// ── cancel target ─────────────────────────────────────────────────────────

test('cancel targets the PAYING subscription, not a newer unpaid checkout link', () => {
  // Paid by sub_a; a later checkout overwrote the link with unpaid sub_y.
  assert.deepEqual(cancelTarget({ subscriptionStatus: 'active', billingSubscriptionId: 'sub_a', razorpaySubscriptionId: 'sub_y' }), { kind: 'paid', subscriptionId: 'sub_a' });
  assert.deepEqual(cancelTarget({ subscriptionStatus: 'past_due', billingSubscriptionId: 'sub_a', razorpaySubscriptionId: 'sub_r' }), { kind: 'paid', subscriptionId: 'sub_a' });
  assert.deepEqual(cancelTarget({ subscriptionStatus: 'active', razorpaySubscriptionId: 'sub_legacy' }), { kind: 'paid', subscriptionId: 'sub_legacy' }, 'legacy paid link');
});

test('trial cancel targets the trial subscription; nothing to cancel otherwise', () => {
  assert.deepEqual(cancelTarget({ subscriptionStatus: 'trial_active', billingSubscriptionId: 'sub_t' }), { kind: 'trial', subscriptionId: 'sub_t', alreadyCancelled: false });
  assert.deepEqual(cancelTarget({ subscriptionStatus: 'trial_active', billingSubscriptionId: 'sub_t', trialCancelledAt: T }), { kind: 'trial', subscriptionId: 'sub_t', alreadyCancelled: true });
  for (const s of [{ subscriptionStatus: 'trialing', razorpaySubscriptionId: 'sub_unpaid' }, { subscriptionStatus: 'canceled', billingSubscriptionId: 'sub_a' }, { subscriptionStatus: 'past_due', razorpaySubscriptionId: 'sub_r' }, null]) {
    assert.deepEqual(cancelTarget(s as any), { kind: 'none' }, JSON.stringify(s));
  }
});

test('workspace selection: owner only; without a selection only an unambiguous single workspace', () => {
  const a = { _id: 'A', subscriptionStatus: 'active', billingSubscriptionId: 'sub_a' };
  const b = { _id: 'B', subscriptionStatus: 'trialing', razorpaySubscriptionId: 'sub_unpaid' };
  const c = { _id: 'C', subscriptionStatus: 'active', billingSubscriptionId: 'sub_c' };
  assert.deepEqual(pickCancelWorkspace([a, b], 'B'), { ok: true, workspace: b }, 'explicit selection wins');
  assert.deepEqual(pickCancelWorkspace([a, b], 'X'), { ok: false, reason: 'not_owner' });
  assert.deepEqual(pickCancelWorkspace([a, b], null), { ok: true, workspace: a }, 'the only one with something to cancel');
  assert.deepEqual(pickCancelWorkspace([a, c], null), { ok: false, reason: 'ambiguous' });
  assert.deepEqual(pickCancelWorkspace([b], null), { ok: false, reason: 'none' });
});
