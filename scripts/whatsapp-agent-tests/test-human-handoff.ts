/**
 * Integration tests for the Phase 8 shared human-handoff trigger
 * (services/agentHandoff/checkHandoffTriggers.ts) and the In-House Agent
 * multi-turn support flow (services/support/supportAgent.ts).
 *
 * Run with:
 *   MONGODB_URI="<your dev/staging URI>" npx tsx scripts/whatsapp-agent-tests/test-human-handoff.ts
 *
 * Creates and cleans up its own throwaway Lead/SupportConversation/
 * SalesConversation docs (prefixed __HANDOFF_TEST__), never touches real
 * tenant data. Safe to run against a dev database; NOT intended for
 * production.
 */
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import Lead from '../../src/models/Lead';
import LeadEvent from '../../src/models/LeadEvent';
import SalesConversation from '../../src/models/SalesConversation';
import OrchestrationConfig from '../../src/models/OrchestrationConfig';
import {
  checkHandoffTriggers,
  isExplicitHumanRequest,
} from '../../src/services/agentHandoff/checkHandoffTriggers';
import { setLeadOwnership } from '../../src/services/leadOwnership/setLeadOwnership';

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
async function makeLead(overrides: Record<string, any> = {}) {
  counter++;
  return Lead.create({
    tenantId: 'gmbboost-internal',
    name: '__HANDOFF_TEST__ lead',
    phone: `+9100000005${String(counter).padStart(2, '0')}`,
    source: 'WhatsApp',
    leadType: 'Platform Prospect',
    currentAgent: 'SALES',
    currentStage: 'NURTURING',
    ...overrides,
  });
}

async function run() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Skipping DB-integration tests (this is expected in sandboxes without DB network access).');
    process.exit(0);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to DB');

  // --- Pure keyword matching (no DB) ----------------------------------------

  await test('isExplicitHumanRequest: matches "talk to a human"', async () => {
    assert.equal(isExplicitHumanRequest('I want to talk to a human please'), true);
  });

  await test('isExplicitHumanRequest: matches "speak to someone"', async () => {
    assert.equal(isExplicitHumanRequest('can I speak to someone'), true);
  });

  await test('isExplicitHumanRequest: matches standalone "agent"', async () => {
    assert.equal(isExplicitHumanRequest('agent'), true);
    assert.equal(isExplicitHumanRequest('Agent!'), true);
  });

  await test('isExplicitHumanRequest: does NOT match unrelated uses of "agent"', async () => {
    assert.equal(isExplicitHumanRequest('my insurance agent said something different'), false);
    assert.equal(isExplicitHumanRequest('your AI agent is really helpful'), false);
  });

  await test('isExplicitHumanRequest: normal messages are not matched', async () => {
    assert.equal(isExplicitHumanRequest('how much does this cost?'), false);
    assert.equal(isExplicitHumanRequest('sounds good, thanks!'), false);
  });

  // --- DoD: explicit "talk to a human" moves ownership to HUMAN ------------

  for (const agentName of ['sales-agent', 'demo-agent', 'in-house-agent'] as const) {
    await test(`DoD: "talk to a human" via ${agentName} moves currentAgent to HUMAN and sets humanHandoff.active`, async () => {
      const lead = await makeLead({ currentAgent: agentName === 'in-house-agent' ? 'IN_HOUSE' : agentName === 'demo-agent' ? 'DEMO' : 'SALES' });
      try {
        const result = await checkHandoffTriggers(lead._id, 'I want to talk to a human', agentName);
        assert.equal(result.handedOff, true);
        assert.equal(result.reason, 'explicit-request');

        const reloaded = await Lead.findById(lead._id).lean();
        assert.equal(reloaded!.currentAgent, 'HUMAN');
        assert.equal(reloaded!.humanHandoff!.active, true);
        assert.equal(reloaded!.humanHandoff!.reason, 'explicit-request');
        assert.ok(reloaded!.humanHandoff!.since);
      } finally {
        await LeadEvent.deleteMany({ leadId: lead._id });
        await Lead.deleteOne({ _id: lead._id });
      }
    });
  }

  // --- DoD: once HUMAN, every subsequent turn is blocked (not just the trigger turn) ---

  await test('DoD: once HUMAN-owned, a NORMAL follow-up message is ALSO blocked (no further AI replies until released)', async () => {
    const lead = await makeLead({ currentAgent: 'SALES' });
    try {
      const first = await checkHandoffTriggers(lead._id, 'talk to a human', 'sales-agent');
      assert.equal(first.handedOff, true);
      assert.equal(first.alreadyHuman, undefined);

      // A completely unrelated, normal message on a LATER turn — must
      // STILL be blocked, since the lead is already HUMAN-owned. This is
      // the exact bug the task asked me to find/fix: the orchestrator's
      // own ownership check never covers these live/synchronous reply
      // paths at all (confirmed by code inspection — every live agent
      // reply calls sendOutboundMessage directly, never
      // requestOutboundMessage), so checkHandoffTriggers itself must be
      // the thing that keeps blocking AI replies on every subsequent turn.
      const second = await checkHandoffTriggers(lead._id, 'hey are you there?', 'sales-agent');
      assert.equal(second.handedOff, true, 'a normal message to an already-HUMAN-owned lead must still be blocked');
      assert.equal(second.alreadyHuman, true);

      const reloaded = await Lead.findById(lead._id).lean();
      assert.equal(reloaded!.currentAgent, 'HUMAN', 'ownership must remain HUMAN, not silently reverted');
    } finally {
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  // --- Trigger 2: two consecutive low-confidence turns ----------------------

  await test('two consecutive low-confidence extraction turns trigger a handoff', async () => {
    const lead = await makeLead({ recentExtractionConfidences: [0.2, 0.35] });
    try {
      const result = await checkHandoffTriggers(lead._id, 'some ambiguous message', 'sales-agent');
      assert.equal(result.handedOff, true);
      assert.equal(result.reason, 'low-confidence-streak');
    } finally {
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('one low-confidence turn (not two consecutive) does NOT trigger a handoff', async () => {
    const lead = await makeLead({ recentExtractionConfidences: [0.8, 0.2] });
    try {
      const result = await checkHandoffTriggers(lead._id, 'a message', 'sales-agent');
      assert.equal(result.handedOff, false);
    } finally {
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  // --- Trigger 3: stuck-hot-lead, threshold read from config ---------------

  await test('a high-score lead stuck in NURTURING past the configured cycle threshold triggers a handoff', async () => {
    const lead = await makeLead({ leadScore: 80, currentStage: 'NURTURING' });
    const convo = await SalesConversation.create({
      businessId: new mongoose.Types.ObjectId(),
      leadPhone: lead.phone,
      phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
      leadName: '__HANDOFF_TEST__',
      status: 'active',
      scores: { businessName: 'test', rank: null, profile: null, seo: null, review: null, competitor: null, missingKeywords: [] },
      followUpsSent: 3,
    });
    try {
      const result = await checkHandoffTriggers(lead._id, 'ok', 'sales-agent');
      assert.equal(result.handedOff, true);
      assert.equal(result.reason, 'stuck-hot-lead');
    } finally {
      await SalesConversation.deleteOne({ _id: convo._id });
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('the stuck-hot-lead threshold is read from OrchestrationConfig, not hardcoded', async () => {
    await OrchestrationConfig.updateOne({ key: 'default' }, { $set: { stuckLeadScoreThreshold: 50, stuckNurtureCyclesThreshold: 1 } }, { upsert: true });
    const lead = await makeLead({ leadScore: 55, currentStage: 'NURTURING' }); // would NOT trigger under the default 76/3 thresholds
    const convo = await SalesConversation.create({
      businessId: new mongoose.Types.ObjectId(),
      leadPhone: lead.phone,
      phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
      leadName: '__HANDOFF_TEST__',
      status: 'active',
      scores: { businessName: 'test', rank: null, profile: null, seo: null, review: null, competitor: null, missingKeywords: [] },
      followUpsSent: 1,
    });
    try {
      const result = await checkHandoffTriggers(lead._id, 'ok', 'sales-agent');
      assert.equal(result.handedOff, true, 'must trigger under the LOWERED config thresholds, proving they are actually read from the config doc');
    } finally {
      await OrchestrationConfig.updateOne({ key: 'default' }, { $set: { stuckLeadScoreThreshold: 76, stuckNurtureCyclesThreshold: 3 } });
      await SalesConversation.deleteOne({ _id: convo._id });
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('a lead below the score threshold does NOT trigger stuck-hot-lead handoff', async () => {
    const lead = await makeLead({ leadScore: 40, currentStage: 'NURTURING' });
    const convo = await SalesConversation.create({
      businessId: new mongoose.Types.ObjectId(),
      leadPhone: lead.phone,
      phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
      leadName: '__HANDOFF_TEST__',
      status: 'active',
      scores: { businessName: 'test', rank: null, profile: null, seo: null, review: null, competitor: null, missingKeywords: [] },
      followUpsSent: 5,
    });
    try {
      const result = await checkHandoffTriggers(lead._id, 'ok', 'sales-agent');
      assert.equal(result.handedOff, false);
    } finally {
      await SalesConversation.deleteOne({ _id: convo._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  // --- DoD: "Return to AI" restores ownership and resumes agent behavior ----

  await test('DoD: releasing a HUMAN-owned lead back to an agent clears humanHandoff.active and resumes normal handoff-check behavior', async () => {
    const lead = await makeLead({ currentAgent: 'HUMAN', humanHandoff: { active: true, reason: 'explicit-request', since: new Date() } });
    try {
      // Simulates the admin "Return to AI" action.
      await setLeadOwnership(lead._id, 'SALES', 'human-released', 'admin-user-id', 'NURTURING');
      const humanReleased = await Lead.findByIdAndUpdate(lead._id, { $set: { 'humanHandoff.active': false } }, { new: true }).lean();
      assert.equal(humanReleased!.currentAgent, 'SALES');
      assert.equal(humanReleased!.humanHandoff!.active, false);

      // Now a normal message should NOT be blocked anymore — ownership has
      // genuinely resumed.
      const result = await checkHandoffTriggers(lead._id, 'hi again', 'sales-agent');
      assert.equal(result.handedOff, false, 'a released lead must resume normal AI behavior, not stay blocked');
    } finally {
      await Lead.deleteOne({ _id: lead._id });
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
