/**
 * Buying-signal merge: unknown dropped, repeat updates, no invent.
 * Run with: node --experimental-strip-types --test tests/integration/buying-signals-merge.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeBuyingSignalRows,
  mergeStringList,
} from '../../src/services/leadIntelligence/buyingSignalsMerge.ts';

test('unknown buying-signal types are dropped', () => {
  const merged = mergeBuyingSignalRows([], ['TOTALLY_FAKE', { type: 'ALSO_FAKE' }, { type: 'PRICING_QUESTION' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].type, 'PRICING_QUESTION');
});

test('repeat type updates detectedAt and does not duplicate', () => {
  const first = mergeBuyingSignalRows([], [{ type: 'PRICING_QUESTION', note: 'how much?' }]);
  const t1 = first[0].detectedAt.getTime();
  const second = mergeBuyingSignalRows(first, [{ type: 'PRICING_QUESTION', note: 'monthly?' }]);
  assert.equal(second.length, 1);
  assert.equal(second[0].note, 'monthly?');
  assert.ok(second[0].detectedAt.getTime() >= t1);
});

test('empty incoming leaves existing signals unchanged', () => {
  const existing = mergeBuyingSignalRows([], [{ type: 'DEMO_REQUESTED' }]);
  const next = mergeBuyingSignalRows(existing, []);
  assert.equal(next.length, 1);
  assert.equal(next[0].type, 'DEMO_REQUESTED');
});

test('score_signal alone can seed a buying signal when array empty', () => {
  const merged = mergeBuyingSignalRows([], [], 'PURCHASE_INTENT');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].type, 'PURCHASE_INTENT');
});

test('profile goals merge adds without wiping prior', () => {
  const goals = mergeStringList(['more reviews'], ['rank #1', 'more reviews']);
  assert.deepEqual(goals, ['more reviews', 'rank #1']);
});
