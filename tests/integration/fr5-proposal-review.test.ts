/**
 * Profile proposal review diff. Pure. No Google calls.
 * Run: node --experimental-strip-types --test tests/integration/fr5-proposal-review.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLY_CONFIRM,
  APPLY_REQUIRES_BOTH_FLAGS,
  APPROVAL_DOES_NOT_PUBLISH,
  ROLLBACK_CONFIRM,
  SENSITIVE_CONFIRM,
  VALIDATION_LIMIT,
  VALIDATION_PASSED,
  validationReview,
  wordDiff,
} from '../../src/app/dashboard/profile-optimization/textDiff.ts';

test('a description edit shows the inserted city and the removed words', () => {
  const before = 'Start here.\nAlpha development beta development gamma development delta development epsilon development end.';
  const proposed = 'Start here in Ojhar.\nAlpha development beta development gamma development end.';
  const parts = wordDiff(before, proposed);
  const inserted = parts.filter((part) => part.type === 'insert').map((part) => part.value).join('');
  const removed = parts.filter((part) => part.type === 'delete').map((part) => part.value).join('');
  const unchanged = parts.filter((part) => part.type === 'equal').map((part) => part.value).join('');

  assert.match(inserted, / in Ojhar/);
  assert.equal(removed.match(/\bdevelopment\b/g)?.length, 2);
  assert.match(removed, /delta/);
  assert.match(removed, /epsilon/);
  assert.match(unchanged, /Start here/);
  assert.match(unchanged, /Alpha development beta development gamma development/);
  assert.match(unchanged, /end\./);
  assert.equal(parts.some((part) => part.type === 'insert' && part.value.includes('development')), false);
});

test('punctuation and repeated spaces stay visible in the diff', () => {
  const parts = wordDiff('Hello.', 'Hello!');
  assert.deepEqual(parts, [
    { type: 'equal', value: 'Hello' },
    { type: 'delete', value: '.' },
    { type: 'insert', value: '!' },
  ]);
  const spaces = wordDiff('a  b', 'a b');
  assert.equal(spaces.some((part) => part.type === 'delete' && part.value === '  '), true);
  assert.equal(spaces.some((part) => part.type === 'insert' && part.value === ' '), true);
  assert.equal(spaces.some((part) => part.type === 'equal' && part.value === 'a'), true);
  assert.equal(spaces.some((part) => part.type === 'equal' && part.value === 'b'), true);
});

test('validation passed is shown only when there are no violations', () => {
  const passed = validationReview({ valid: true, violations: [] });
  assert.equal(passed.passed, true);
  assert.equal(VALIDATION_PASSED, 'Validation passed.');
  assert.match(VALIDATION_LIMIT, /does not prove this change is safe/);
  assert.match(VALIDATION_LIMIT, /Google will accept/);

  const failed = validationReview({ valid: false, violations: [{ message: 'A word is repeated too often.' }], warnings: [{ message: 'Check the opening.' }] });
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.violations, ['A word is repeated too often.']);
  assert.deepEqual(failed.warnings, ['Check the opening.']);

  const contradicted = validationReview({ valid: true, violations: [{ message: 'Still blocked.' }] });
  assert.equal(contradicted.passed, false);
  assert.equal(validationReview(null).passed, false);
});

test('approval copy does not treat approval as publication', () => {
  assert.match(APPROVAL_DOES_NOT_PUBLISH, /does not change your Google profile/);
  assert.match(APPLY_REQUIRES_BOTH_FLAGS, /separate step/);
  assert.match(APPLY_REQUIRES_BOTH_FLAGS, /nothing is sent/);
  assert.match(APPLY_CONFIRM, /nothing is sent/);
});

test('customer copy never names internal settings or environment variables', () => {
  for (const copy of [APPROVAL_DOES_NOT_PUBLISH, APPLY_REQUIRES_BOTH_FLAGS, APPLY_CONFIRM, ROLLBACK_CONFIRM, SENSITIVE_CONFIRM, VALIDATION_LIMIT, VALIDATION_PASSED]) {
    assert.equal(/GBP_|_ENABLED|process\.env|\b[A-Z]{2,}_[A-Z_]+\b/.test(copy), false, copy);
  }
});
