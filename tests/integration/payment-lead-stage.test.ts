/**
 * Payment stage invariants — no Razorpay network.
 * Run with: node --experimental-strip-types --test tests/integration/payment-lead-stage.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stageOnPaymentFailure,
  paymentSuccessStageSequence,
} from '../../src/services/billing/paymentLeadStages.ts';

test('failed payment never sets CUSTOMER; uses CONVERSION_PENDING', () => {
  assert.equal(stageOnPaymentFailure('NURTURING'), 'CONVERSION_PENDING');
  assert.equal(stageOnPaymentFailure('DEMO_COMPLETED'), 'CONVERSION_PENDING');
  assert.equal(stageOnPaymentFailure(null), 'CONVERSION_PENDING');
});

test('failed payment does not downgrade CUSTOMER or PAYMENT_VERIFIED', () => {
  assert.equal(stageOnPaymentFailure('CUSTOMER'), null);
  assert.equal(stageOnPaymentFailure('PAYMENT_VERIFIED'), null);
  assert.equal(stageOnPaymentFailure('DO_NOT_CONTACT'), null);
  assert.equal(stageOnPaymentFailure('LOST'), null);
});

test('success sequence is PAYMENT_VERIFIED then CUSTOMER', () => {
  assert.deepEqual(paymentSuccessStageSequence(), ['PAYMENT_VERIFIED', 'CUSTOMER']);
  const [first, second] = paymentSuccessStageSequence();
  assert.notEqual(first, 'CUSTOMER');
  assert.equal(second, 'CUSTOMER');
});
