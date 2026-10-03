/**
 * Pure tests for silence → UNRESPONSIVE → LONG_TERM_NURTURE progression.
 * Run with: node --test tests/integration/quiet-stage.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceQuietStage } from '../../src/services/lifecycle/advanceQuietStage.ts';

const hour = 60 * 60 * 1000;

test('no transition until all follow-ups are sent', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const lastAgentAt = new Date(now.getTime() - 80 * hour);
  assert.equal(
    advanceQuietStage({
      currentStage: 'NURTURING',
      currentAgent: 'SALES',
      nurtureStatus: 'ACTIVE',
      followUpsSent: 1,
      followUpCount: 2,
      lastDelayHours: 72,
      lastAgentAt,
      lastLeadReplyAt: null,
      now,
    }),
    null
  );
});

test('NURTURING → UNRESPONSIVE after drip finishes and lastDelayHours elapse', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const lastAgentAt = new Date(now.getTime() - 72 * hour);
  assert.equal(
    advanceQuietStage({
      currentStage: 'NURTURING',
      currentAgent: 'SALES',
      nurtureStatus: 'ACTIVE',
      followUpsSent: 2,
      followUpCount: 2,
      lastDelayHours: 72,
      lastAgentAt,
      lastLeadReplyAt: null,
      now,
    }),
    'UNRESPONSIVE'
  );
});

test('UNRESPONSIVE → LONG_TERM_NURTURE after another lastDelayHours', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const lastAgentAt = new Date(now.getTime() - 72 * hour);
  assert.equal(
    advanceQuietStage({
      currentStage: 'UNRESPONSIVE',
      currentAgent: 'SALES',
      nurtureStatus: 'ACTIVE',
      followUpsSent: 2,
      followUpCount: 2,
      lastDelayHours: 72,
      lastAgentAt,
      lastLeadReplyAt: null,
      now,
    }),
    'LONG_TERM_NURTURE'
  );
});

test('custom lastDelayHours is honored (not hardcoded 72)', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const lastAgentAt = new Date(now.getTime() - 48 * hour);
  assert.equal(
    advanceQuietStage({
      currentStage: 'NURTURING',
      currentAgent: 'SALES',
      nurtureStatus: 'ACTIVE',
      followUpsSent: 1,
      followUpCount: 1,
      lastDelayHours: 48,
      lastAgentAt,
      lastLeadReplyAt: null,
      now,
    }),
    'UNRESPONSIVE'
  );
  assert.equal(
    advanceQuietStage({
      currentStage: 'NURTURING',
      currentAgent: 'SALES',
      nurtureStatus: 'ACTIVE',
      followUpsSent: 1,
      followUpCount: 1,
      lastDelayHours: 48,
      lastAgentAt: new Date(now.getTime() - 47 * hour),
      lastLeadReplyAt: null,
      now,
    }),
    null
  );
});

test('human-owned and opted-out never advance', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const lastAgentAt = new Date(now.getTime() - 100 * hour);
  const common = {
    currentStage: 'NURTURING' as const,
    followUpsSent: 2,
    followUpCount: 2,
    lastDelayHours: 72,
    lastAgentAt,
    lastLeadReplyAt: null,
    now,
  };
  assert.equal(
    advanceQuietStage({ ...common, currentAgent: 'HUMAN', nurtureStatus: 'ACTIVE', humanHandoffActive: true }),
    null
  );
  assert.equal(
    advanceQuietStage({ ...common, currentAgent: 'SALES', nurtureStatus: 'OPTED_OUT' }),
    null
  );
});

test('a lead reply blocks silence progression', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  assert.equal(
    advanceQuietStage({
      currentStage: 'NURTURING',
      currentAgent: 'SALES',
      nurtureStatus: 'ACTIVE',
      followUpsSent: 2,
      followUpCount: 2,
      lastDelayHours: 72,
      lastAgentAt: new Date(now.getTime() - 100 * hour),
      lastLeadReplyAt: new Date(now.getTime() - 1 * hour),
      now,
    }),
    null
  );
});
