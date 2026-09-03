/**
 * Regression tests for the deterministic "explicit human request" detector
 * (src/services/agentHandoff/humanRequest.ts) and the NBA hard rule that
 * consumes it (src/services/nba/rules.ts's explicitHumanRequestAction).
 *
 * Context — the bug these lock down:
 *   A LEAD_ENGINE_V2 trace showed an active SALES lead whose message
 *   requested a human. The primary handoff regex (checkHandoffTriggers) only
 *   matched a few exact phrasings and missed this one, so the LLM's
 *   `HUMAN_HANDOFF` suggestion reached decideNextAction, where NO rule listed
 *   HUMAN_HANDOFF as legal for a normal SALES stage — it was rejected as
 *   `illegal_for_current_state` and silently overridden to OFFER_DEMO. No
 *   handoff ever happened.
 *
 * Pure functions, no DB, no `@/` aliases.
 * Run with: node --test tests/integration/human-request-detection.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExplicitHumanRequest } from '../../src/services/agentHandoff/humanRequest.ts';
import {
  explicitHumanRequestAction,
  findMatchingRules,
  type NBARuleInput,
} from '../../src/services/nba/rules.ts';

const salesNew: Pick<NBARuleInput, 'currentAgent' | 'nurtureStatus' | 'currentStage'> = {
  currentAgent: 'SALES',
  nurtureStatus: 'ACTIVE',
  currentStage: 'NEW',
};

// --- A. phrasings that MUST be recognised as an explicit human request -----
const POSITIVE = [
  'talk to a person',
  'can I talk to a person?',
  'I want to speak to a human',
  'speak to someone please',
  'let me talk to a representative',
  'connect me with a rep',
  'transfer me to an agent',
  'get me a human',
  'I need to chat with your team',
  'can I speak to someone from your team',
  'someone from your team please',
  'a person from support',
  'human',
  'human please',
  'real person!!',
  'representative?',
  'agent pls',
  'I don\'t want a bot',
  'stop the bot',
  'no bot',
];

for (const msg of POSITIVE) {
  test(`isExplicitHumanRequest TRUE: ${JSON.stringify(msg)}`, () => {
    assert.equal(isExplicitHumanRequest(msg), true);
  });
}

// --- false positives that must NOT trigger a handoff ----------------------
const NEGATIVE = [
  '',
  '   ',
  'how much does it cost?',
  'do you integrate with my booking system?',
  'your AI agent is really helpful',
  'I am a real estate agent looking for leads',
  'I work with an insurance agent',
  'we need a travel agent portal',
  'can the bot book me a demo', // asking the bot to do something, not for a human
  'what can you do for my business',
];

for (const msg of NEGATIVE) {
  test(`isExplicitHumanRequest FALSE: ${JSON.stringify(msg)}`, () => {
    assert.equal(isExplicitHumanRequest(msg), false);
  });
}

// --- A (cont). the NBA hard rule turns it into HUMAN_HANDOFF --------------
test('A: "talk to a person" from a SALES/NEW lead -> HUMAN_HANDOFF hard action', () => {
  assert.equal(explicitHumanRequestAction(salesNew, 'can I talk to a person'), 'HUMAN_HANDOFF');
});

test('A: hard rule fires from DEMO ownership and NURTURING stage too', () => {
  assert.equal(
    explicitHumanRequestAction(
      { currentAgent: 'DEMO', nurtureStatus: 'ACTIVE', currentStage: 'DEMO_REQUESTED' },
      'please connect me with someone from your team',
    ),
    'HUMAN_HANDOFF',
  );
  assert.equal(
    explicitHumanRequestAction(
      { currentAgent: 'IN_HOUSE', nurtureStatus: 'ACTIVE', currentStage: 'NURTURING' },
      'I want a human',
    ),
    'HUMAN_HANDOFF',
  );
});

test('A: hard rule returns null for a normal sales question (no override)', () => {
  assert.equal(explicitHumanRequestAction(salesNew, 'how much is it per month?'), null);
});

// --- B. a lead a human already owns is left alone ------------------------
test('B: hard rule does NOT re-fire when a human already owns the lead', () => {
  assert.equal(
    explicitHumanRequestAction(
      { currentAgent: 'HUMAN', nurtureStatus: 'ACTIVE', currentStage: 'HUMAN_HANDOFF' },
      'talk to a person',
    ),
    null,
  );
});

test('B: HUMAN-owned lead still resolves to an absolute WAIT-only legal set (no AI send)', () => {
  const matches = findMatchingRules({
    currentStage: 'NURTURING',
    intent: 'DEMO_INTEREST',
    scoreBand: 'HOT',
    hasOpenObjection: false,
    currentAgent: 'HUMAN',
    nurtureStatus: 'ACTIVE',
  });
  const absolute = matches.find((r) => r.absolute && r.name.includes('Human'));
  assert.ok(absolute, 'HUMAN ownership must match an absolute rule');
  assert.deepEqual(absolute!.legalActions, ['WAIT']);
});

test('B: hard rule does NOT fire for an opted-out / do-not-contact lead', () => {
  assert.equal(
    explicitHumanRequestAction(
      { currentAgent: 'SALES', nurtureStatus: 'OPTED_OUT', currentStage: 'NURTURING' },
      'talk to a person',
    ),
    null,
  );
  assert.equal(
    explicitHumanRequestAction(
      { currentAgent: 'SALES', nurtureStatus: 'ACTIVE', currentStage: 'DO_NOT_CONTACT' },
      'talk to a person',
    ),
    null,
  );
});

// --- HUMAN_HANDOFF is now a legal action for active AI-owned stages -------
test('HUMAN_HANDOFF is legal for NEW / QUALIFYING / NURTURING SALES leads', () => {
  for (const stage of ['NEW', 'QUALIFYING', 'NURTURING'] as const) {
    const matches = findMatchingRules({
      currentStage: stage,
      intent: 'EXPLORING',
      scoreBand: 'WARM',
      hasOpenObjection: false,
      currentAgent: 'SALES',
      nurtureStatus: 'ACTIVE',
    });
    const legal = new Set(matches.flatMap((r) => r.legalActions));
    assert.ok(legal.has('HUMAN_HANDOFF'), `${stage} must allow HUMAN_HANDOFF as a legal action`);
  }
});

test('adding HUMAN_HANDOFF did not change the defaultAction for those rows', () => {
  const matchesNew = findMatchingRules({
    currentStage: 'NEW', intent: undefined, scoreBand: 'COLD',
    hasOpenObjection: false, currentAgent: 'SALES', nurtureStatus: 'ACTIVE',
  });
  assert.equal(matchesNew[0]?.defaultAction, 'ASK_QUALIFICATION');
  const matchesNurture = findMatchingRules({
    currentStage: 'NURTURING', intent: undefined, scoreBand: 'WARM',
    hasOpenObjection: false, currentAgent: 'SALES', nurtureStatus: 'ACTIVE',
  });
  assert.equal(matchesNurture[0]?.defaultAction, 'SHOW_VALUE');
});
