/**
 * Unit test for the shared human-handoff / opt-out guard
 * (src/services/agentHandoff/isHumanOwned.ts).
 *
 * Pure predicate functions — the only import there is `import type` (erased at
 * runtime by Node's type-stripping), so this loads under `node --test` with no
 * DB and no `@/` alias resolution.
 *
 * These two predicates are the P0 safety gate every outbound AI path calls
 * (sales / booking / support / report agents, the sales drip, the legacy CRM
 * follow-up job, the demo-reminder tick, the platform static menu). The cases
 * below pin down exactly which Lead states must block an automated send.
 *
 * Run with: node --test tests/integration/human-handoff-guard.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHumanOwned, isOptedOutOrDoNotContact } from '../../src/services/agentHandoff/isHumanOwned.ts';

test('isHumanOwned: true when currentAgent is HUMAN', () => {
  assert.equal(isHumanOwned({ currentAgent: 'HUMAN', humanHandoff: undefined } as any), true);
});

test('isHumanOwned: true when humanHandoff.active even if currentAgent lags', () => {
  assert.equal(isHumanOwned({ currentAgent: 'SALES', humanHandoff: { active: true } } as any), true);
});

test('isHumanOwned: false for a normal AI-owned lead', () => {
  for (const agent of ['NONE', 'SALES', 'DEMO', 'IN_HOUSE']) {
    assert.equal(
      isHumanOwned({ currentAgent: agent, humanHandoff: { active: false } } as any),
      false,
      `${agent} + inactive handoff should not be human-owned`,
    );
  }
});

test('isHumanOwned: false (not a crash) for null / undefined lead', () => {
  assert.equal(isHumanOwned(null), false);
  assert.equal(isHumanOwned(undefined), false);
});

test('isOptedOutOrDoNotContact: true for OPTED_OUT / STOPPED / DO_NOT_CONTACT', () => {
  assert.equal(isOptedOutOrDoNotContact({ nurtureStatus: 'OPTED_OUT', currentStage: 'NURTURING' } as any), true);
  assert.equal(isOptedOutOrDoNotContact({ nurtureStatus: 'STOPPED', currentStage: 'NURTURING' } as any), true);
  assert.equal(isOptedOutOrDoNotContact({ nurtureStatus: 'ACTIVE', currentStage: 'DO_NOT_CONTACT' } as any), true);
});

test('isOptedOutOrDoNotContact: false for an active, contactable lead', () => {
  assert.equal(isOptedOutOrDoNotContact({ nurtureStatus: 'ACTIVE', currentStage: 'NURTURING' } as any), false);
  assert.equal(isOptedOutOrDoNotContact(null), false);
  assert.equal(isOptedOutOrDoNotContact(undefined), false);
});

test('the two guards are independent: a HUMAN-owned lead is not automatically "opted out"', () => {
  const lead = { currentAgent: 'HUMAN', humanHandoff: { active: true }, nurtureStatus: 'ACTIVE', currentStage: 'NURTURING' } as any;
  assert.equal(isHumanOwned(lead), true);
  assert.equal(isOptedOutOrDoNotContact(lead), false);
  // Callers that need both properties (e.g. the sales drip, the demo-reminder
  // tick) must call BOTH — this asserts neither one silently covers the other.
});
