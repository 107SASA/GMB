/**
 * SEC-3 — QA_TESTING_MODE must never disable security controls in production.
 *
 * Pure-function test. `isQaTestingMode()` gates the rate-limit / signup-
 * protection / dev-route bypasses; this locks in that it is impossible to
 * turn on when NODE_ENV === 'production', no matter what QA_TESTING_MODE is.
 *
 * Run with: node --test tests/integration/security/qa-testing-mode.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQaTestingMode } from '../../../src/lib/testingMode.ts';

function withEnv(node: string | undefined, qa: string | undefined, fn: () => void) {
  const pn = process.env.NODE_ENV;
  const pq = process.env.QA_TESTING_MODE;
  try {
    if (node === undefined) delete (process.env as any).NODE_ENV; else (process.env as any).NODE_ENV = node;
    if (qa === undefined) delete process.env.QA_TESTING_MODE; else process.env.QA_TESTING_MODE = qa;
    fn();
  } finally {
    if (pn === undefined) delete (process.env as any).NODE_ENV; else (process.env as any).NODE_ENV = pn;
    if (pq === undefined) delete process.env.QA_TESTING_MODE; else process.env.QA_TESTING_MODE = pq;
  }
}

test('production + QA_TESTING_MODE=true → still OFF (the SEC-3 fix)', () => {
  withEnv('production', 'true', () => assert.equal(isQaTestingMode(), false));
});

test('production + QA_TESTING_MODE unset → OFF', () => {
  withEnv('production', undefined, () => assert.equal(isQaTestingMode(), false));
});

test('development + QA_TESTING_MODE=true → ON (intended dev/QA behaviour)', () => {
  withEnv('development', 'true', () => assert.equal(isQaTestingMode(), true));
});

test('development + QA_TESTING_MODE=false → OFF', () => {
  withEnv('development', 'false', () => assert.equal(isQaTestingMode(), false));
});

test('test env + QA_TESTING_MODE=true → ON (not production)', () => {
  withEnv('test', 'true', () => assert.equal(isQaTestingMode(), true));
});
