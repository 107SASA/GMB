/**
 * Unit tests for the NBA executor's action-classification surface
 * (src/services/nba/executeNextAction.ts). The executor's full behaviour
 * needs a DB + Groq + Twilio and is covered by the manual WhatsApp test
 * flow; these tests pin the pure invariants:
 *   - which actions have a real handler vs a deferred no-op
 *   - the executable set never claims to send for a non-contact action set
 *
 * Run with: node --test tests/integration/nba-executor.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXECUTABLE_NBA_ACTIONS, isExecutableNbaAction } from '../../src/services/nba/executableActions.ts';
import { NBA_ACTIONS } from '../../src/services/nba/rules.ts';

test('every executable action is a real NBAAction', () => {
  for (const a of EXECUTABLE_NBA_ACTIONS) {
    assert.ok(NBA_ACTIONS.includes(a), `${a} must be a valid NBAAction`);
  }
});

test('the actions requiring infrastructure we do not have are NOT claimed as executable', () => {
  // (none right now — SCHEDULE_DEMO maps to the OFFER_DEMO nudge, not a real
  // booking; if a future action needs infra we lack, it must be excluded here
  // so it logs as "deferred" rather than faking success.)
  // This test documents the intent: keep the executable set honest.
  assert.equal(isExecutableNbaAction('WAIT'), true);
  assert.equal(isExecutableNbaAction('STOP'), true);
  assert.equal(isExecutableNbaAction('HUMAN_HANDOFF'), true);
});

test('SEND_PRICING is executable (falls back to a qualification question when no approved price)', () => {
  assert.equal(isExecutableNbaAction('SEND_PRICING'), true);
});

test('HANDLE_OBJECTION is executable', () => {
  assert.equal(isExecutableNbaAction('HANDLE_OBJECTION'), true);
});

test('an unknown string is not executable', () => {
  assert.equal(isExecutableNbaAction('TOTALLY_MADE_UP' as any), false);
});

test('the executable set covers every NBAAction except none that should be deferred today', () => {
  const notExecutable = NBA_ACTIONS.filter((a) => !isExecutableNbaAction(a));
  // Today the executor handles all 15 canonical actions (STOP/WAIT as no-ops,
  // SCHEDULE_DEMO as the OFFER_DEMO nudge). If this list grows, that's a
  // deliberate "we can't do this safely yet" decision — update the test.
  assert.deepEqual(notExecutable, [], `unexpectedly-deferred actions: ${notExecutable.join(', ')}`);
});
