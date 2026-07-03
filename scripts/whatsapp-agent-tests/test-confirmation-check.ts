/**
 * Pure-logic test for quickConfirmationCheck (the keyword fast-path used
 * before falling back to an LLM call for confirmation classification).
 * Run with: npx tsx scripts/whatsapp-agent-tests/test-confirmation-check.ts
 */
import assert from 'node:assert/strict';
import { quickConfirmationCheck } from '../../src/services/whatsapp-agent/intentClassifier';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e: any) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${e.message}`);
  }
}

test('"Yes" is recognized as yes', () => {
  assert.equal(quickConfirmationCheck('Yes'), 'yes');
});
test('"yes please book it" is recognized as yes', () => {
  assert.equal(quickConfirmationCheck('yes please book it'), 'yes');
});
test('"No" is recognized as no', () => {
  assert.equal(quickConfirmationCheck('No'), 'no');
});
test('"nope, cancel that" is recognized as no', () => {
  assert.equal(quickConfirmationCheck('nope, cancel that'), 'no');
});
test('an ambiguous message returns null (falls back to LLM)', () => {
  assert.equal(quickConfirmationCheck('Actually can we do Friday instead?'), null);
});
test('a greeting is not misread as a confirmation', () => {
  assert.equal(quickConfirmationCheck('Hi there!'), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
