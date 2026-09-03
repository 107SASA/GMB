/**
 * Unit tests for the NBA rule engine (src/services/nba/rules.ts) — pure
 * functions, no DB, no `@/` aliases. Locks in the decision behaviour the
 * executor and salesAgentReply depend on:
 *   - score band boundaries
 *   - HUMAN / opted-out hard stops win absolutely
 *   - explicit purchase / demo intent overrides stage progression
 *   - demo-stage rows beat the generic demo-intent override
 *   - every stage resolves to at least one legal action
 *
 * Run with: node --test tests/integration/nba-rules.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeScoreBand,
  findMatchingRules,
  NBA_ACTIONS,
  NBA_RULES,
  type NBARuleInput,
} from '../../src/services/nba/rules.ts';

const base: NBARuleInput = {
  currentStage: 'NEW',
  intent: 'EXPLORING',
  scoreBand: 'COLD',
  hasOpenObjection: false,
  currentAgent: 'SALES',
  nurtureStatus: 'ACTIVE',
};

test('computeScoreBand boundaries', () => {
  assert.equal(computeScoreBand(0), 'COLD');
  assert.equal(computeScoreBand(14), 'COLD');
  assert.equal(computeScoreBand(15), 'WARM');
  assert.equal(computeScoreBand(44), 'WARM');
  assert.equal(computeScoreBand(45), 'HOT');
  assert.equal(computeScoreBand(74), 'HOT');
  assert.equal(computeScoreBand(75), 'READY');
  assert.equal(computeScoreBand(100), 'READY');
  assert.equal(computeScoreBand(undefined), 'COLD');
});

test('HUMAN ownership produces an absolute WAIT-only rule', () => {
  const matches = findMatchingRules({ ...base, currentAgent: 'HUMAN', intent: 'READY_TO_BUY' });
  const absolute = matches.find((r) => r.absolute && r.name.includes('Human'));
  assert.ok(absolute, 'a HUMAN absolute rule must match');
  assert.deepEqual(absolute!.legalActions, ['WAIT']);
});

test('opted-out produces an absolute STOP-only rule regardless of stage/intent', () => {
  const matches = findMatchingRules({
    ...base, nurtureStatus: 'OPTED_OUT', intent: 'READY_TO_BUY', currentStage: 'NURTURING',
  });
  const absolute = matches.find((r) => r.absolute && r.name.includes('Opted out'));
  assert.ok(absolute, 'an opted-out absolute rule must match');
  assert.deepEqual(absolute!.legalActions, ['STOP']);
});

test('explicit purchase intent adds OFFER_SUBSCRIPTION/SEND_PRICING even from an early stage', () => {
  const matches = findMatchingRules({ ...base, currentStage: 'NURTURING', intent: 'PURCHASE_INTEREST' });
  const union = new Set(matches.flatMap((r) => r.legalActions));
  assert.ok(union.has('OFFER_SUBSCRIPTION'));
  assert.ok(union.has('SEND_PRICING'));
});

test('demo-requested stage defaults to SCHEDULE_DEMO, not OFFER_DEMO again', () => {
  const matches = findMatchingRules({ ...base, currentStage: 'DEMO_REQUESTED', intent: 'DEMO_INTEREST' });
  assert.equal(matches[0]?.defaultAction, 'SCHEDULE_DEMO', 'first matching row (highest priority default) is the demo-requested row');
});

test('demo-completed defaults to FOLLOW_UP_AFTER_DEMO', () => {
  const matches = findMatchingRules({ ...base, currentStage: 'DEMO_COMPLETED' });
  assert.equal(matches[0]?.defaultAction, 'FOLLOW_UP_AFTER_DEMO');
});

test('open objection during nurture defaults to HANDLE_OBJECTION', () => {
  const matches = findMatchingRules({ ...base, currentStage: 'NURTURING', hasOpenObjection: true });
  assert.equal(matches[0]?.defaultAction, 'HANDLE_OBJECTION');
});

test('every LeadStage resolves to at least one matching rule with a legal action', () => {
  const stages: NBARuleInput['currentStage'][] = [
    'NEW', 'QUALIFYING', 'NURTURING', 'DEMO_REQUESTED', 'DEMO_SCHEDULED', 'DEMO_COMPLETED',
    'CONVERSION_PENDING', 'PAYMENT_VERIFIED', 'CUSTOMER', 'COLD', 'UNRESPONSIVE',
    'LONG_TERM_NURTURE', 'LOST', 'DO_NOT_CONTACT', 'HUMAN_HANDOFF',
  ];
  for (const stage of stages) {
    const matches = findMatchingRules({ ...base, currentStage: stage, intent: undefined });
    assert.ok(matches.length > 0, `stage ${stage} must match at least one rule`);
    const union = matches.flatMap((r) => r.legalActions);
    assert.ok(union.length > 0, `stage ${stage} must yield at least one legal action`);
    for (const a of union) assert.ok(NBA_ACTIONS.includes(a), `${a} is a valid NBAAction`);
  }
});

test('CUSTOMER and PAYMENT_VERIFIED never yield a message-sending default action', () => {
  for (const stage of ['CUSTOMER', 'PAYMENT_VERIFIED'] as const) {
    const matches = findMatchingRules({ ...base, currentStage: stage, intent: undefined });
    assert.ok(['WAIT', 'HUMAN_HANDOFF', 'STOP'].includes(matches[0]!.defaultAction),
      `${stage} default must be a non-send action, got ${matches[0]!.defaultAction}`);
  }
});

test('NBA_RULES priority: the three absolute rules are listed before any progression rule', () => {
  const firstNonAbsolute = NBA_RULES.findIndex((r) => !r.absolute);
  const lastAbsolute = NBA_RULES.map((r, i) => (r.absolute ? i : -1)).filter((i) => i >= 0).pop()!;
  assert.ok(lastAbsolute < firstNonAbsolute, 'all absolute rules must precede non-absolute rules');
});
