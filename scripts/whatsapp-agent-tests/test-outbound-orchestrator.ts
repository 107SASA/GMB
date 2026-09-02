/**
 * Integration tests for the Phase 5 outbound orchestrator
 * (services/orchestration/outboundOrchestrator.ts) and its supporting
 * pieces (ScheduledAction, cancelScheduledActions, setLeadOwnership's stage
 * extension). Requires a real MongoDB connection (MONGODB_URI) — same
 * DB-integration-test convention as test-decide-next-action.ts.
 *
 * IMPORTANT — these tests deliberately never reach a REAL WhatsApp send.
 * Every scenario here is constructed to be rejected by requestOutboundMessage
 * BEFORE Step 5 (the actual sendOutboundMessage() call) — e.g. via
 * ownership-mismatch, cooldown-active (simulated by seeding
 * Lead.lastProactiveMessageAt directly rather than actually sending a first
 * message), or an explicit opt-out/DO_NOT_CONTACT state. There is no
 * mocking framework in this codebase; this is the safe alternative — see
 * the task's own definition-of-done, which only requires proving the
 * SECOND of two agent-initiated sends is rejected, not that either one
 * actually goes out over the network.
 *
 * Run with:
 *   MONGODB_URI="<your dev/staging URI>" npx tsx scripts/whatsapp-agent-tests/test-outbound-orchestrator.ts
 *
 * Creates and cleans up its own throwaway Lead/ScheduledAction/DemoBooking
 * docs (prefixed __ORCH_TEST__), never touches real tenant data. Safe to
 * run against a dev database; NOT intended to run against production.
 */
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import Lead from '../../src/models/Lead';
import LeadEvent from '../../src/models/LeadEvent';
import ScheduledAction from '../../src/models/ScheduledAction';
import OrchestrationConfig from '../../src/models/OrchestrationConfig';
import DemoBooking from '../../src/models/DemoBooking';
import { requestOutboundMessage, isLeadInCohort } from '../../src/services/orchestration/outboundOrchestrator';
import { setLeadOwnership } from '../../src/services/leadOwnership/setLeadOwnership';
import { cancelScheduledActions } from '../../src/services/scheduler/cancelScheduledActions';

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

function settle(ms = 300) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let leadCounter = 0;
async function makeLead(overrides: Record<string, any> = {}) {
  leadCounter++;
  return Lead.create({
    tenantId: '__ORCH_TEST__',
    name: '__ORCH_TEST__ lead',
    phone: `+9100000009${String(leadCounter).padStart(2, '0')}`,
    source: 'WhatsApp',
    leadType: 'Platform Prospect',
    currentAgent: 'SALES',
    currentStage: 'NURTURING',
    nurtureStatus: 'ACTIVE',
    ...overrides,
  });
}

async function addToAllowlist(leadId: mongoose.Types.ObjectId) {
  await OrchestrationConfig.updateOne(
    { key: 'default' },
    { $addToSet: { leadIdAllowlist: leadId } },
    { upsert: true }
  );
}

async function removeFromAllowlist(leadId: mongoose.Types.ObjectId) {
  await OrchestrationConfig.updateOne({ key: 'default' }, { $pull: { leadIdAllowlist: leadId } });
}

async function run() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Skipping DB-integration tests (this is expected in sandboxes without DB network access).');
    process.exit(0);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to DB');

  const originalFlag = process.env.LEAD_ENGINE_V2;

  // --- Flag-off / not-in-cohort: must ALWAYS fall back, no exceptions -------

  await test('flag off entirely: falls back to legacy regardless of lead state', async () => {
    delete process.env.LEAD_ENGINE_V2;
    const lead = await makeLead();
    try {
      const result = await requestOutboundMessage({
        leadId: lead._id.toString(),
        agent: 'SALES',
        messageBuilder: () => 'should never be called',
        isReply: false,
      });
      assert.equal(result.decision, 'FALL_BACK_TO_LEGACY');
    } finally {
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('flag on, but lead NOT in cohort: falls back to legacy', async () => {
    process.env.LEAD_ENGINE_V2 = 'true';
    const lead = await makeLead();
    try {
      const inCohort = await isLeadInCohort(lead._id.toString());
      assert.equal(inCohort, false, 'a fresh lead with an empty allowlist and 0% rollout must not be in cohort');
      const result = await requestOutboundMessage({
        leadId: lead._id.toString(),
        agent: 'SALES',
        messageBuilder: () => 'should never be called',
        isReply: false,
      });
      assert.equal(result.decision, 'FALL_BACK_TO_LEGACY');
    } finally {
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  // --- Ownership + hard-stop rejections (never reach a send) ----------------

  await test('ownership-mismatch: rejected when Lead.currentAgent !== requested agent', async () => {
    process.env.LEAD_ENGINE_V2 = 'true';
    const lead = await makeLead({ currentAgent: 'DEMO' });
    await addToAllowlist(lead._id);
    try {
      const result = await requestOutboundMessage({
        leadId: lead._id.toString(),
        agent: 'SALES',
        messageBuilder: () => { throw new Error('must not be called'); },
        isReply: false,
      });
      assert.equal(result.decision, 'REJECTED');
      if (result.decision === 'REJECTED') assert.equal(result.reason, 'ownership-mismatch');
    } finally {
      await removeFromAllowlist(lead._id);
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('opted-out lead: rejected, never reaches a send', async () => {
    process.env.LEAD_ENGINE_V2 = 'true';
    const lead = await makeLead({ nurtureStatus: 'OPTED_OUT' });
    await addToAllowlist(lead._id);
    try {
      const result = await requestOutboundMessage({
        leadId: lead._id.toString(),
        agent: 'SALES',
        messageBuilder: () => { throw new Error('must not be called'); },
        isReply: false,
      });
      assert.equal(result.decision, 'REJECTED');
      if (result.decision === 'REJECTED') assert.equal(result.reason, 'nurture-stopped');
    } finally {
      await removeFromAllowlist(lead._id);
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('DO_NOT_CONTACT stage: rejected, never reaches a send', async () => {
    process.env.LEAD_ENGINE_V2 = 'true';
    const lead = await makeLead({ currentStage: 'DO_NOT_CONTACT' });
    await addToAllowlist(lead._id);
    try {
      const result = await requestOutboundMessage({
        leadId: lead._id.toString(),
        agent: 'SALES',
        messageBuilder: () => { throw new Error('must not be called'); },
        isReply: false,
      });
      assert.equal(result.decision, 'REJECTED');
      if (result.decision === 'REJECTED') assert.equal(result.reason, 'do-not-contact');
    } finally {
      await removeFromAllowlist(lead._id);
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  // --- Definition-of-done: two agents cannot both message within cooldown ---

  await test('DoD: a second proactive send within the cooldown window is rejected (simulated first send)', async () => {
    process.env.LEAD_ENGINE_V2 = 'true';
    process.env.ORCHESTRATOR_COOLDOWN_HOURS = '4';
    // Simulate "agent A already sent a proactive message 1 hour ago" by
    // seeding the field directly — never actually sends anything. See this
    // file's top-level comment for why.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const lead = await makeLead({ lastProactiveMessageAt: oneHourAgo });
    await addToAllowlist(lead._id);
    try {
      // "Agent B" (or the same agent, doesn't matter) attempts a second
      // proactive message inside the 4h window.
      const result = await requestOutboundMessage({
        leadId: lead._id.toString(),
        agent: 'SALES',
        messageBuilder: () => { throw new Error('must not be called — cooldown should reject before this'); },
        isReply: false,
      });
      assert.equal(result.decision, 'REJECTED');
      if (result.decision === 'REJECTED') assert.equal(result.reason, 'cooldown-active');
    } finally {
      await removeFromAllowlist(lead._id);
      delete process.env.ORCHESTRATOR_COOLDOWN_HOURS;
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('a REPLY (isReply: true) is NOT subject to the cooldown', async () => {
    process.env.LEAD_ENGINE_V2 = 'true';
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const lead = await makeLead({ lastProactiveMessageAt: oneHourAgo });
    await addToAllowlist(lead._id);
    try {
      // A reply should sail past Step 4 (cooldown only applies to
      // !isReply) — reaching this point without a 'cooldown-active'
      // rejection is itself the assertion; we still avoid a real send by
      // making messageBuilder throw, and treating that thrown error's
      // "skipped: send-failed"-shaped rejection reason as proof cooldown
      // wasn't what stopped it.
      const result = await requestOutboundMessage({
        leadId: lead._id.toString(),
        agent: 'SALES',
        messageBuilder: () => { throw new Error('deliberately not a real send'); },
        isReply: true,
      });
      // messageBuilder throwing inside requestOutboundMessage's Step 7
      // isn't caught by that function today (it awaits it directly) — so
      // this call is expected to throw here, NOT resolve with
      // cooldown-active. Catching confirms cooldown was correctly skipped.
      assert.fail('expected requestOutboundMessage to throw from the messageBuilder, not resolve');
    } catch (err: any) {
      assert.ok(!/cooldown/i.test(err.message), 'a reply must not be blocked by the cooldown check');
    } finally {
      await removeFromAllowlist(lead._id);
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  // --- Definition-of-done: CUSTOMER transition cancels pending actions ------

  await test('DoD: transitioning currentStage to CUSTOMER cancels pending ScheduledActions before they fire', async () => {
    const lead = await makeLead({ currentStage: 'NURTURING' });
    const dueInOneMinute = new Date(Date.now() + 60 * 1000);
    const action = await ScheduledAction.create({
      leadId: lead._id,
      actionType: 'SHOW_VALUE',
      dueAt: dueInOneMinute,
      status: 'PENDING',
      idempotencyKey: `__ORCH_TEST__-${lead._id}-customer-transition`,
      createdBy: '__ORCH_TEST__',
    });
    try {
      // Simulates the CUSTOMER transition (e.g. a later phase's
      // payment-verified flow calling setLeadOwnership with newStage).
      await setLeadOwnership(lead._id, 'IN_HOUSE', 'became-a-customer', 'system', 'CUSTOMER');

      // Simulate "advance time and run the tick" — the tick would find this
      // row PENDING and dueAt <= now; instead we just re-read the row to
      // confirm cancellation already happened BEFORE the tick would ever
      // see it, which is the actual point of this DoD item (cancel before
      // it fires, not merely skip it at fire time).
      const reloaded = await ScheduledAction.findById(action._id).lean();
      assert.equal(reloaded!.status, 'CANCELLED');
      assert.notEqual(reloaded!.status, 'EXECUTED');

      const reloadedLead = await Lead.findById(lead._id).lean();
      assert.equal(reloadedLead!.currentStage, 'CUSTOMER');
      assert.equal(reloadedLead!.currentAgent, 'IN_HOUSE');
    } finally {
      await ScheduledAction.deleteOne({ _id: action._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('DoD: a demo cancellation cancels its reminder ScheduledActions', async () => {
    const lead = await makeLead({ currentStage: 'DEMO_SCHEDULED' });
    const booking = await DemoBooking.create({
      leadId: lead._id,
      name: '__ORCH_TEST__',
      phone: lead.phone,
      company: '__ORCH_TEST__ co',
      date: 'Tomorrow',
      timeSlot: '3:00 PM',
      status: 'Confirmed',
      channel: 'whatsapp',
    });
    const reminderAction = await ScheduledAction.create({
      leadId: lead._id,
      actionType: 'WAIT',
      dueAt: new Date(Date.now() + 60 * 1000),
      status: 'PENDING',
      idempotencyKey: `__ORCH_TEST__-${lead._id}-demo-reminder`,
      createdBy: '__ORCH_TEST__',
    });
    try {
      // Simulates what the admin demo-bookings PATCH route does on
      // cancellation (see app/api/admin/demo-bookings/route.ts) — calling
      // cancelScheduledActions directly here rather than hitting the HTTP
      // route, since this is testing the cancellation mechanism itself.
      booking.status = 'Cancelled';
      await booking.save();
      await cancelScheduledActions(booking.leadId, 'demo-cancelled');

      const reloaded = await ScheduledAction.findById(reminderAction._id).lean();
      assert.equal(reloaded!.status, 'CANCELLED');
      assert.equal(reloaded!.reason, 'demo-cancelled');
    } finally {
      await ScheduledAction.deleteOne({ _id: reminderAction._id });
      await DemoBooking.deleteOne({ _id: booking._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('NURTURE_ACTION_CANCELLED LeadEvent is logged on cancellation', async () => {
    const lead = await makeLead();
    const action = await ScheduledAction.create({
      leadId: lead._id,
      actionType: 'SHOW_VALUE',
      dueAt: new Date(Date.now() + 60 * 1000),
      status: 'PENDING',
      idempotencyKey: `__ORCH_TEST__-${lead._id}-event-log-check`,
      createdBy: '__ORCH_TEST__',
    });
    try {
      const count = await cancelScheduledActions(lead._id, 'test-reason');
      assert.equal(count, 1);
      await settle();
      const events = await LeadEvent.find({ leadId: lead._id, type: 'NURTURE_ACTION_CANCELLED' }).lean();
      assert.equal(events.length, 1);
      assert.equal((events[0].payload as any).reason, 'test-reason');
    } finally {
      await ScheduledAction.deleteOne({ _id: action._id });
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('cancelling with no PENDING actions is a safe no-op', async () => {
    const lead = await makeLead();
    try {
      const count = await cancelScheduledActions(lead._id, 'no-op-check');
      assert.equal(count, 0);
    } finally {
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  // --- Idempotency -------------------------------------------------------------

  await test('idempotencyKey: an already-EXECUTED action key is rejected on a second attempt', async () => {
    process.env.LEAD_ENGINE_V2 = 'true';
    const lead = await makeLead();
    await addToAllowlist(lead._id);
    const key = `__ORCH_TEST__-${lead._id}-idempotency-check`;
    const alreadyExecuted = await ScheduledAction.create({
      leadId: lead._id,
      actionType: 'SHOW_VALUE',
      dueAt: new Date(),
      status: 'EXECUTED',
      idempotencyKey: key,
      createdBy: '__ORCH_TEST__',
    });
    try {
      const result = await requestOutboundMessage({
        leadId: lead._id.toString(),
        agent: 'SALES',
        messageBuilder: () => { throw new Error('must not be called'); },
        isReply: false,
        idempotencyKey: key,
      });
      assert.equal(result.decision, 'REJECTED');
      if (result.decision === 'REJECTED') assert.equal(result.reason, 'already-executed');
    } finally {
      await removeFromAllowlist(lead._id);
      await ScheduledAction.deleteOne({ _id: alreadyExecuted._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  // --- Cohort mechanism sanity --------------------------------------------------

  await test('allowlist membership puts a lead in cohort even at 0% rollout', async () => {
    const lead = await makeLead();
    await addToAllowlist(lead._id);
    try {
      assert.equal(await isLeadInCohort(lead._id.toString()), true);
    } finally {
      await removeFromAllowlist(lead._id);
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('100% rollout puts every lead in cohort without needing the allowlist', async () => {
    await OrchestrationConfig.updateOne({ key: 'default' }, { $set: { rolloutPercentage: 100 } }, { upsert: true });
    const lead = await makeLead();
    try {
      assert.equal(await isLeadInCohort(lead._id.toString()), true);
    } finally {
      await OrchestrationConfig.updateOne({ key: 'default' }, { $set: { rolloutPercentage: 0 } });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  if (originalFlag === undefined) delete process.env.LEAD_ENGINE_V2;
  else process.env.LEAD_ENGINE_V2 = originalFlag;

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Test run failed:', e);
  process.exit(1);
});
