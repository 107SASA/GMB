/**
 * Score band boundaries: 0–25 Cold, 26–50 Warm, 51–75 Hot, 76–100 Ready.
 * Run with: node --experimental-strip-types --test tests/integration/lead-score-bands.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScoreBand } from '../../src/services/nba/rules.ts';

test('band boundaries at 25/50/75', () => {
  assert.equal(computeScoreBand(0), 'COLD');
  assert.equal(computeScoreBand(25), 'COLD');
  assert.equal(computeScoreBand(26), 'WARM');
  assert.equal(computeScoreBand(50), 'WARM');
  assert.equal(computeScoreBand(51), 'HOT');
  assert.equal(computeScoreBand(75), 'HOT');
  assert.equal(computeScoreBand(76), 'READY');
  assert.equal(computeScoreBand(100), 'READY');
});

test('null/undefined score is COLD', () => {
  assert.equal(computeScoreBand(null), 'COLD');
  assert.equal(computeScoreBand(undefined), 'COLD');
});
