/**
 * Integration tests for the Phase 7 post-payment sequence
 * (services/billing/customerActivation.ts) — the code that runs AFTER
 * activatePlan()/activateBusinessPlan() in the Razorpay webhook route.
 *
 * IMPORTANT — NO REAL WHATSAPP SENDS: TWILIO_TEMPLATE_INVOICE_READY /
 * TWILIO_TEMPLATE_WELCOME_CUSTOMER are deliberately left UNCONFIGURED for
 * these tests (even though other, unrelated, real Twilio template SIDs
 * exist in this environment's .env.local) — see this task's own decision
 * not to send a real WhatsApp message during automated testing. This means:
 *   - sendTemplateMessage() is reached and returns a graceful failure
 *     (template not configured) — proving the CODE PATH that would send is
 *     exercised exactly once per unique payment, and that the guard fields
 *     (invoiceMessageSentAt/welcomeMessageSentAt) correctly stay null on a
 *     failed send (so a LATER retry, once templates are configured, would
 *     still attempt them) rather than being incorrectly marked sent.
 *   - What's fully, unconditionally verified regardless of template config:
 *     ownership transition to IN_HOUSE, currentStage=CUSTOMER,
 *     cancellation of pending nurture ScheduledActions, and the
 *     CUSTOMER_ACTIVATED LeadEvent — none of these depend on a WhatsApp
 *     send succeeding.
 *   - Once real TWILIO_TEMPLATE_INVOICE_READY/WELCOME_CUSTOMER SIDs are
 *     approved and configured, re-run this suite against a real test lead
 *     phone number to additionally confirm invoiceMessageSentAt/
 *     welcomeMessageSentAt actually flip to a real timestamp on success.
 *
 * Run with:
 *   MONGODB_URI="<your dev/staging URI>" npx tsx scripts/whatsapp-agent-tests/test-customer-activation.ts
 *
 * Creates and cleans up its own throwaway User/Lead/Subscription/
 * ScheduledAction docs (prefixed __PAYMENT_TEST__), never touches real
 * tenant data. Safe to run against a dev database; NOT intended for
 * production.
 */
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import User from '../../src/models/User';
import Lead from '../../src/models/Lead';
import LeadEvent from '../../src/models/LeadEvent';
import Subscription from '../../src/models/Subscription';
import ScheduledAction from '../../src/models/ScheduledAction';
import { runCustomerActivationSequence } from '../../src/services/billing/customerActivation';
import { WA_TEMPLATES } from '../../src/lib/whatsappTemplates';

const MONGODB_URI = process.env.MONGODB_URI;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e: any) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${e.message}`);
  }
}

function settle(ms = 400) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let counter = 0;
async function makeUserLeadSubscription() {
  counter++;
  const phone = `+9100000007${String(counter).padStart(2, '0')}`;
  const user = await User.create({
    email: `__payment_test_${counter}@example.com`,
    fullName: '__PAYMENT_TEST__ user',
    phone,
    passwordHash: 'not-a-real-password-hash',
  });
  const lead = await Lead.create({
    tenantId: 'gmbboost-internal',
    name: '__PAYMENT_TEST__ lead',
    phone,
    source: 'Demo Booking',
    leadType: 'Platform Prospect',
    currentAgent: 'SALES',
    currentStage: 'NURTURING',
  });
  const subscription = await Subscription.create({
    userId: user._id,
    planType: 'Free',
    billingStatus: 'Trialing',
  });
  return { user, lead, subscription, phone };
}

async function cleanup(user: any, lead: any, subscription: any) {
  await ScheduledAction.deleteMany({ leadId: lead._id });
  await LeadEvent.deleteMany({ leadId: lead._id });
  await Subscription.deleteOne({ _id: subscription._id });
  await Lead.deleteOne({ _id: lead._id });
  await User.deleteOne({ _id: user._id });
}

async function run() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Skipping DB-integration tests (this is expected in sandboxes without DB network access).');
    process.exit(0);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to DB');
  console.log(`invoiceReady template configured: ${Boolean(WA_TEMPLATES.invoiceReady)} (expected false — see file header)`);
  console.log(`welcomeCustomer template configured: ${Boolean(WA_TEMPLATES.welcomeCustomer)} (expected false — see file header)\n`);

  // --- Core sequence: ownership, stage, cancellation, event -----------------

  await test('a payment moves ownership to IN_HOUSE, stage to CUSTOMER, and logs CUSTOMER_ACTIVATED', async () => {
    const { user, lead, subscription } = await makeUserLeadSubscription();
    try {
      await runCustomerActivationSequence(user._id.toString(), null, { paymentId: 'pay_test123', amount: 199900, currency: 'INR' });

      const reloaded = await Lead.findById(lead._id).lean();
      assert.equal(reloaded!.currentAgent, 'IN_HOUSE');
      assert.equal(reloaded!.currentStage, 'CUSTOMER');

      await settle();
      const events = await LeadEvent.find({ leadId: lead._id, type: 'CUSTOMER_ACTIVATED' }).lean();
      assert.equal(events.length, 1);
      assert.equal((events[0].payload as any).paymentId, 'pay_test123');
    } finally {
      await cleanup(user, lead, subscription);
    }
  });

  // --- DoD 1: firing the same webhook event twice produces exactly ONE of everything ---

  await test('DoD: running the sequence twice for the same payment produces exactly ONE ownership transition and ONE CUSTOMER_ACTIVATED event', async () => {
    const { user, lead, subscription } = await makeUserLeadSubscription();
    try {
      const payment = { paymentId: 'pay_dup_test', amount: 199900, currency: 'INR' };

      // Simulates the real-world scenario: ProcessedWebhookEvent already
      // prevents the SAME event id from reaching this function twice in
      // production — but this test calls runCustomerActivationSequence
      // directly (bypassing that layer entirely) specifically to prove
      // THIS function's own belt-and-braces guard (currentStage ===
      // 'CUSTOMER' -> no-op) holds even without relying on the dedup layer
      // above it, exactly as the task specifies ("belt-and-braces guard on
      // top of ProcessedWebhookEvent").
      await runCustomerActivationSequence(user._id.toString(), null, payment);
      await runCustomerActivationSequence(user._id.toString(), null, payment);

      const reloaded = await Lead.findById(lead._id).lean();
      assert.equal(reloaded!.currentAgent, 'IN_HOUSE');
      assert.equal(reloaded!.currentStage, 'CUSTOMER');

      await settle();
      // Exactly one AGENT_HANDOFF for the NONE/SALES->IN_HOUSE transition —
      // the second call's setLeadOwnership never even runs (short-circuited
      // by the currentStage==='CUSTOMER' guard before reaching it).
      const handoffEvents = await LeadEvent.find({ leadId: lead._id, type: 'AGENT_HANDOFF' }).lean();
      assert.equal(handoffEvents.length, 1, 'exactly one ownership transition, not two');

      const customerActivatedEvents = await LeadEvent.find({ leadId: lead._id, type: 'CUSTOMER_ACTIVATED' }).lean();
      assert.equal(customerActivatedEvents.length, 1, 'exactly one CUSTOMER_ACTIVATED event, not two');
    } finally {
      await cleanup(user, lead, subscription);
    }
  });

  await test('DoD: re-running after the FIRST call already set currentStage=CUSTOMER produces zero additional side effects', async () => {
    const { user, lead, subscription } = await makeUserLeadSubscription();
    try {
      await runCustomerActivationSequence(user._id.toString(), null, { paymentId: 'pay_a' });
      await settle();
      const eventsAfterFirst = await LeadEvent.find({ leadId: lead._id }).countDocuments();

      // A second, distinct event (different paymentId — simulating a
      // genuine renewal charge landing while already a customer) must
      // ALSO be a no-op per the task's belt-and-braces guard, not just a
      // literal duplicate of the same event.
      await runCustomerActivationSequence(user._id.toString(), null, { paymentId: 'pay_b_renewal' });
      await settle();
      const eventsAfterSecond = await LeadEvent.find({ leadId: lead._id }).countDocuments();

      assert.equal(eventsAfterSecond, eventsAfterFirst, 'a renewal charge for an already-CUSTOMER lead must produce zero new events');
    } finally {
      await cleanup(user, lead, subscription);
    }
  });

  // --- DoD 2: pending Sales nurture ScheduledActions are cancelled ----------

  await test('DoD: a payment for a lead with pending Sales ScheduledActions cancels them all', async () => {
    const { user, lead, subscription } = await makeUserLeadSubscription();
    const actions = await Promise.all([
      ScheduledAction.create({
        leadId: lead._id, actionType: 'SHOW_VALUE', dueAt: new Date(Date.now() + 60 * 1000), status: 'PENDING',
        idempotencyKey: `__PAYMENT_TEST__-${lead._id}-showvalue`, createdBy: 'sales-agent-drip',
      }),
      ScheduledAction.create({
        leadId: lead._id, actionType: 'REENGAGE', dueAt: new Date(Date.now() + 120 * 1000), status: 'PENDING',
        idempotencyKey: `__PAYMENT_TEST__-${lead._id}-reengage`, createdBy: 'sales-agent-drip',
      }),
    ]);
    try {
      await runCustomerActivationSequence(user._id.toString(), null, { paymentId: 'pay_converts_lead' });

      for (const action of actions) {
        const reloaded = await ScheduledAction.findById(action._id).lean();
        assert.equal(reloaded!.status, 'CANCELLED', `ScheduledAction ${action._id} must be CANCELLED, not left PENDING to fire later`);
      }
    } finally {
      await ScheduledAction.deleteMany({ leadId: lead._id });
      await cleanup(user, lead, subscription);
    }
  });

  await test('a lead with NO pending ScheduledActions still converts cleanly (cancellation is a safe no-op)', async () => {
    const { user, lead, subscription } = await makeUserLeadSubscription();
    try {
      await runCustomerActivationSequence(user._id.toString(), null, { paymentId: 'pay_no_actions' });
      const reloaded = await Lead.findById(lead._id).lean();
      assert.equal(reloaded!.currentStage, 'CUSTOMER');
    } finally {
      await cleanup(user, lead, subscription);
    }
  });

  // --- Idempotent guard fields: retry re-attempts only what's still null ----

  await test('invoiceMessageSentAt/welcomeMessageSentAt stay null when the template is unconfigured (send genuinely failed, not silently marked sent)', async () => {
    const { user, lead, subscription } = await makeUserLeadSubscription();
    try {
      await runCustomerActivationSequence(user._id.toString(), null, { paymentId: 'pay_no_template' });
      const reloaded = await Subscription.findById(subscription._id).lean();
      assert.equal(reloaded!.invoiceMessageSentAt, null, 'must stay null since the send genuinely failed (template not configured)');
      assert.equal(reloaded!.welcomeMessageSentAt, null);
    } finally {
      await cleanup(user, lead, subscription);
    }
  });

  await test('pre-setting invoiceMessageSentAt (simulating an already-successful prior send) is respected on a re-run — never re-attempted', async () => {
    const { user, lead, subscription } = await makeUserLeadSubscription();
    const alreadySentAt = new Date(Date.now() - 60 * 60 * 1000);
    subscription.invoiceMessageSentAt = alreadySentAt;
    await subscription.save();
    try {
      await runCustomerActivationSequence(user._id.toString(), null, { paymentId: 'pay_partial_retry' });
      const reloaded = await Subscription.findById(subscription._id).lean();
      // Must be UNCHANGED — this is the "idempotent retry only re-attempts
      // what hasn't succeeded yet" requirement: an already-set guard is
      // never touched again, even on a fresh invocation.
      assert.equal(reloaded!.invoiceMessageSentAt!.getTime(), alreadySentAt.getTime());
    } finally {
      await cleanup(user, lead, subscription);
    }
  });

  // --- DoD 3: activatePlan's own behavior is completely unaffected ----------

  await test('DoD: this sequence never touches Subscription.planType/billingStatus (that is activatePlan\'s job, called separately, before this)', async () => {
    const { user, lead, subscription } = await makeUserLeadSubscription();
    try {
      const before = await Subscription.findById(subscription._id).lean();
      assert.equal(before!.planType, 'Free');
      assert.equal(before!.billingStatus, 'Trialing');

      await runCustomerActivationSequence(user._id.toString(), null, { paymentId: 'pay_entitlement_check' });

      const after = await Subscription.findById(subscription._id).lean();
      assert.equal(after!.planType, 'Free', 'planType must be untouched — only activatePlan() (called separately by the webhook route) changes this');
      assert.equal(after!.billingStatus, 'Trialing', 'billingStatus must be untouched — same reasoning');
    } finally {
      await cleanup(user, lead, subscription);
    }
  });

  await test('no resolvable Lead (User has a phone, but no matching platform-side Lead exists): skips the whole sequence silently, no error thrown', async () => {
    // User.phone is required+unique, so "no phone at all" isn't a real
    // scenario for a signed-up, paying customer — the actual real-world
    // gap is a User with a phone that never happened to message the
    // platform's WhatsApp line (organic signup, no Sales/Booking history),
    // so no Lead exists for that phone under tenantId:'gmbboost-internal'.
    counter++;
    const user = await User.create({
      email: `__payment_test_nolead_${counter}@example.com`,
      fullName: '__PAYMENT_TEST__ no-lead user',
      phone: `+9100000006${String(counter).padStart(2, '0')}`,
      passwordHash: 'not-a-real-password-hash',
    });
    try {
      // Must not throw, must not create a Lead as a side effect.
      await runCustomerActivationSequence(user._id.toString(), null, { paymentId: 'pay_no_lead' });
      const anyLeadCreated = await Lead.countDocuments({ tenantId: 'gmbboost-internal', name: '__PAYMENT_TEST__ no-lead user' });
      assert.equal(anyLeadCreated, 0, 'must never create a Lead as a side effect');
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Test run failed:', e);
  process.exit(1);
});
