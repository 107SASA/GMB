/**
 * Schema-invariant tests for the ScheduledAction / DemoBooking status values
 * that nurtureSchedulerTick and buildMessageForAction branch on.
 *
 * These don't touch a database — mongoose.model() only registers a schema at
 * import time. They exist because several Pass B/C fixes hard-code status
 * strings ('DEMO_REMINDER', 'Completed', 'No Show', 'PENDING', 'CANCELLED')
 * in control flow; if one of those enums is ever renamed, the tick would
 * silently stop skipping stale bookings or stop claiming rows. This catches
 * that at test time instead of in production.
 *
 * Run with: node --test tests/integration/scheduled-action-invariants.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ScheduledAction from '../../src/models/ScheduledAction.ts';
import DemoBooking from '../../src/models/DemoBooking.ts';

test('ScheduledAction.status enum still contains the states the tick relies on', () => {
  const values: string[] = (ScheduledAction.schema.path('status') as any).enumValues;
  for (const required of ['PENDING', 'EXECUTED', 'SKIPPED', 'CANCELLED']) {
    assert.ok(values.includes(required), `ScheduledAction.status must allow "${required}"`);
  }
});

test('ScheduledAction.actionType enum still contains DEMO_REMINDER and NO_SHOW_CHECK', () => {
  const values: string[] = (ScheduledAction.schema.path('actionType') as any).enumValues;
  assert.ok(values.includes('DEMO_REMINDER'), 'actionType must allow "DEMO_REMINDER" (tick special-cases it)');
  assert.ok(values.includes('NO_SHOW_CHECK'), 'actionType must allow "NO_SHOW_CHECK" (tick special-cases it)');
});

test('ScheduledAction has the claimedAt field the atomic claim writes', () => {
  assert.ok(ScheduledAction.schema.path('claimedAt'), 'ScheduledAction.claimedAt must exist for the atomic-claim guard');
});

test('DemoBooking.status enum still contains the no-longer-scheduled states the reminder skip checks', () => {
  const values: string[] = (DemoBooking.schema.path('status') as any).enumValues;
  for (const required of ['Cancelled', 'Completed', 'No Show']) {
    assert.ok(
      values.includes(required),
      `DemoBooking.status must allow "${required}" — buildMessageForAction skips DEMO_REMINDER for these`,
    );
  }
});
