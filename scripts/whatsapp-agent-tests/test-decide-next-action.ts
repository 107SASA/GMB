/**
 * Unit/DB-integration tests for the Phase 4 next-best-action engine
 * (services/nba/rules.ts + services/nba/decideNextAction.ts). Requires a
 * real MongoDB connection (uses MONGODB_URI from the environment) since
 * decideNextAction() reads/writes/saves a real Lead document — same
 * approach as test-appointment-lifecycle.ts in this folder.
 *
 * Run with:
 *   MONGODB_URI="<your dev/staging URI>" npx tsx scripts/whatsapp-agent-tests/test-decide-next-action.ts
 *
 * Creates and cleans up its own throwaway Lead docs (prefixed __NBA_TEST__),
 * never touches real tenant data. Safe to run against a dev database; NOT
 * intended to run against production.
 */
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import Lead from '../../src/models/Lead';
import LeadEvent from '../../src/models/LeadEvent';
import { decideNextAction } from '../../src/services/nba/decideNextAction';
import { findMatchingRules, computeScoreBand } from '../../src/services/nba/rules';

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

// logLeadEvent (Phase 1) is deliberately fire-and-forget — never awaited by
// its callers, including decideNextAction's NBA_OVERRIDDEN log — so a test
// that asserts on a LeadEvent row immediately after calling decideNextAction
// can race ahead of that write. A short settle is the same workaround the
// Phase 3 verification script used for the identical race.
function settle(ms = 300) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeLead(overrides: Record<string, any> = {}) {
  return Lead.create({
    tenantId: '__NBA_TEST__',
    name: '__NBA_TEST__ lead',
    phone: '+910000000999',
    source: 'WhatsApp',
    leadType: 'Platform Prospect',
    currentStage: 'NEW',
    currentAgent: 'SALES',
    nurtureStatus: 'ACTIVE',
    intent: 'EXPLORING',
    leadScore: 0,
    objections: [],
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

  // --- Pure rule-table tests (no DB needed, but grouped here for one run) --

  await test('(a) PRICE objection in NURTURING narrows legal actions and excludes generic re-engagement', async () => {
    const matches = findMatchingRules({
      currentStage: 'NURTURING',
      intent: 'SOLUTION_AWARE',
      scoreBand: 'WARM',
      hasOpenObjection: true,
      currentAgent: 'SALES',
      nurtureStatus: 'ACTIVE',
    });
    const legal = new Set(matches.flatMap((r) => r.legalActions));
    assert.ok(legal.has('HANDLE_OBJECTION'), 'HANDLE_OBJECTION should be legal');
    assert.ok(!legal.has('REENGAGE'), 'REENGAGE (generic re-engagement) must NOT be legal while an objection is open');
    const objectionRule = matches.find((r) => r.name.includes('Open objection'));
    assert.ok(objectionRule, 'the open-objection rule row should match');
    assert.equal(objectionRule!.defaultAction, 'HANDLE_OBJECTION');
  });

  await test('(a) via decideNextAction: PRICE objection produces HANDLE_OBJECTION, not a generic follow-up', async () => {
    const lead = await makeLead({
      currentStage: 'NURTURING',
      objections: [{ type: 'PRICE', note: 'too expensive', detectedAt: new Date(), resolved: false }],
    });
    try {
      const result = await decideNextAction(lead, {});
      assert.equal(result.action, 'HANDLE_OBJECTION');
      assert.ok(!result.legalActions.includes('REENGAGE'));
    } finally {
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('(b) low-score lead with explicit PURCHASE_INTEREST gets OFFER_SUBSCRIPTION, not a qualification question', async () => {
    const lead = await makeLead({
      currentStage: 'NEW', // would normally mean ASK_QUALIFICATION
      leadScore: 5, // COLD band — score alone would suggest early-stage handling
      intent: 'PURCHASE_INTEREST',
    });
    try {
      assert.equal(computeScoreBand(lead.leadScore), 'COLD');
      const result = await decideNextAction(lead, {});
      assert.equal(result.action, 'OFFER_SUBSCRIPTION');
      assert.notEqual(result.action, 'ASK_QUALIFICATION');
    } finally {
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('(b) READY_TO_BUY also overrides stage progression', async () => {
    const lead = await makeLead({ currentStage: 'NURTURING', leadScore: 10, intent: 'READY_TO_BUY' });
    try {
      const result = await decideNextAction(lead, {});
      assert.equal(result.action, 'OFFER_SUBSCRIPTION');
    } finally {
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('(c) an illegal LLM suggestion is overridden and produces an NBA_OVERRIDDEN event', async () => {
    const lead = await makeLead({ currentStage: 'NEW' }); // legal set: ASK_QUALIFICATION, EDUCATE, ANSWER_QUESTION
    try {
      const result = await decideNextAction(lead, { suggested_action: 'OFFER_SUBSCRIPTION', confidence: 0.9 });
      assert.equal(result.overridden, true);
      assert.equal(result.usedLLMSuggestion, false);
      assert.equal(result.action, 'ASK_QUALIFICATION'); // NEW stage's defaultAction

      await settle();
      const events = await LeadEvent.find({ leadId: lead._id, type: 'NBA_OVERRIDDEN' }).lean();
      assert.equal(events.length, 1, 'exactly one NBA_OVERRIDDEN event should be logged');
      assert.equal((events[0].payload as any).suggested, 'OFFER_SUBSCRIPTION');
      assert.equal((events[0].payload as any).used, 'ASK_QUALIFICATION');
      assert.equal((events[0].payload as any).reason, 'illegal_for_current_state');
    } finally {
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('(c) a legal but low-confidence LLM suggestion is also overridden', async () => {
    const lead = await makeLead({ currentStage: 'NEW' });
    try {
      // ANSWER_QUESTION IS legal for NEW, but confidence is below threshold.
      const result = await decideNextAction(lead, { suggested_action: 'ANSWER_QUESTION', confidence: 0.2 });
      assert.equal(result.overridden, true);
      assert.equal(result.action, 'ASK_QUALIFICATION');

      await settle();
      const events = await LeadEvent.find({ leadId: lead._id, type: 'NBA_OVERRIDDEN' }).lean();
      assert.equal(events.length, 1);
      assert.equal((events[0].payload as any).reason, 'confidence_below_threshold');
    } finally {
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('(c) counter-check: a legal, high-confidence suggestion is used with NO override event', async () => {
    const lead = await makeLead({ currentStage: 'NEW' });
    try {
      const result = await decideNextAction(lead, { suggested_action: 'EDUCATE', confidence: 0.8 });
      assert.equal(result.overridden, false);
      assert.equal(result.usedLLMSuggestion, true);
      assert.equal(result.action, 'EDUCATE');

      await settle();
      const events = await LeadEvent.find({ leadId: lead._id, type: 'NBA_OVERRIDDEN' }).lean();
      assert.equal(events.length, 0, 'no override event should be logged when the suggestion is accepted');
    } finally {
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('(d) HUMAN ownership always resolves to WAIT regardless of stage/intent/score', async () => {
    const lead = await makeLead({
      currentAgent: 'HUMAN',
      currentStage: 'NURTURING',
      intent: 'READY_TO_BUY', // would normally strongly suggest OFFER_SUBSCRIPTION
      leadScore: 95, // READY band
    });
    try {
      const result = await decideNextAction(lead, { suggested_action: 'OFFER_SUBSCRIPTION', confidence: 0.99 });
      assert.equal(result.action, 'WAIT');
      assert.deepEqual(result.legalActions, ['WAIT']);
      assert.equal(result.overridden, true, 'the high-confidence suggestion should still be rejected — WAIT is the only legal action');
    } finally {
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('(d) HUMAN ownership wins even with no LLM suggestion at all', async () => {
    const lead = await makeLead({ currentAgent: 'HUMAN', currentStage: 'DEMO_COMPLETED' });
    try {
      const result = await decideNextAction(lead, {});
      assert.equal(result.action, 'WAIT');
    } finally {
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('OPTED_OUT nurtureStatus always resolves to STOP', async () => {
    const lead = await makeLead({ nurtureStatus: 'OPTED_OUT', currentStage: 'NURTURING', intent: 'PURCHASE_INTEREST' });
    try {
      const result = await decideNextAction(lead, { suggested_action: 'OFFER_SUBSCRIPTION', confidence: 0.95 });
      assert.equal(result.action, 'STOP');
      assert.deepEqual(result.legalActions, ['STOP']);
    } finally {
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('DO_NOT_CONTACT stage always resolves to STOP', async () => {
    const lead = await makeLead({ currentStage: 'DO_NOT_CONTACT' });
    try {
      const result = await decideNextAction(lead, {});
      assert.equal(result.action, 'STOP');
    } finally {
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('nextBestAction and nextActionAt are persisted onto the Lead document', async () => {
    const lead = await makeLead({ currentStage: 'DEMO_COMPLETED' });
    try {
      const before = Date.now();
      await decideNextAction(lead, {});
      const reloaded = await Lead.findById(lead._id).lean();
      assert.equal(reloaded!.nextBestAction, 'FOLLOW_UP_AFTER_DEMO');
      assert.ok(reloaded!.nextActionAt, 'nextActionAt should be set');
      assert.ok(new Date(reloaded!.nextActionAt as any).getTime() >= before);
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
