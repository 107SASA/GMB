/**
 * Google access verdict (services/gbp/access/evaluate.ts) — pure.
 * Run: node --experimental-strip-types --test tests/integration/google-access.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGoogleAccess, googleAccessAllows, googleAccessCopy } from '../../src/services/gbp/access/evaluate.ts';

const at = '2026-11-06T06:00:00.000Z';
const meta = (status: string, error?: any) => ({ status, fetchedAt: at, lastSuccessfulFetchAt: status === 'SUCCESS' ? at : null, error: error ?? null }) as any;
const location = (md: Record<string, unknown> = {}) => ({
  meta: meta('SUCCESS'),
  data: { metadata: { hasVoiceOfMerchant: true, canOperateLocalPost: true, canModifyServiceList: true, hasGoogleUpdated: false, hasPendingEdits: false, ...md } },
}) as any;
const failedLocation = (category: string, httpStatus: number | null) => ({ meta: meta('FAILED', { category, httpStatus, message: 'The caller does not have permission' }), data: null }) as any;
const verification = (data: Record<string, unknown>) => ({ meta: meta('SUCCESS'), data: { hasVoiceOfMerchant: true, hasBusinessAuthority: true, waitForVoiceOfMerchant: false, verify: null, resolveOwnershipConflict: false, complyWithGuidelines: null, ...data } }) as any;

test('location reads, verified, may post → verified', () => {
  const v = evaluateGoogleAccess({ authRevoked: false, location: location(), verification: verification({}) });
  assert.equal(v?.state, 'verified');
  assert.equal(v?.canPost, true);
  assert.equal(v?.canEdit, true);
});

test("Michelle's case: Google refuses the location (403) → blocked, no_permission", () => {
  const v = evaluateGoogleAccess({ authRevoked: false, location: failedLocation('AUTHORIZATION', 403), verification: null });
  assert.equal(v?.state, 'blocked');
  assert.equal(v?.reason, 'no_permission');
  assert.match(String(v?.detail), /permission/);
});

test('profile read never ran but the metrics read was refused → blocked', () => {
  const v = evaluateGoogleAccess({ authRevoked: false, location: null, verification: null, metricsError: { category: 'AUTHORIZATION', httpStatus: 403, message: 'PERMISSION_DENIED' } });
  assert.equal(v?.state, 'blocked');
  assert.equal(v?.reason, 'no_permission');
});

test('location gone (404) → blocked, location_gone; revoked token → token_revoked', () => {
  assert.equal(evaluateGoogleAccess({ authRevoked: false, location: failedLocation('NOT_FOUND', 404), verification: null })?.reason, 'location_gone');
  assert.equal(evaluateGoogleAccess({ authRevoked: true, location: location(), verification: null })?.reason, 'token_revoked');
});

test('reads but not verified / pending / suspended / cannot post → limited with the reason', () => {
  assert.deepEqual(
    [
      evaluateGoogleAccess({ authRevoked: false, location: location({ hasVoiceOfMerchant: false }), verification: null }),
      evaluateGoogleAccess({ authRevoked: false, location: location(), verification: verification({ verify: { hasPendingVerification: true } }) }),
      evaluateGoogleAccess({ authRevoked: false, location: location(), verification: verification({ complyWithGuidelines: { recommendationReason: 'BUSINESS_LOCATION_SUSPENDED' } }) }),
      evaluateGoogleAccess({ authRevoked: false, location: location({ canOperateLocalPost: false }), verification: null }),
    ].map((v) => [v?.state, v?.reason]),
    [['limited', 'not_verified'], ['limited', 'verification_pending'], ['limited', 'suspended'], ['limited', 'cannot_post']],
  );
});

test('a Google outage, rate limit or our own API config proves nothing → null (keep the previous state)', () => {
  for (const [category, status] of [['TEMPORARY', 503], ['RATE_LIMIT', 429], ['CONFIGURATION', 403], ['AUTHENTICATION', 401]] as const) {
    assert.equal(evaluateGoogleAccess({ authRevoked: false, location: failedLocation(category, status), verification: null }), null, category);
  }
  assert.equal(evaluateGoogleAccess({ authRevoked: false, location: null, verification: null, metricsError: { category: 'TEMPORARY', httpStatus: 500, message: 'x' } }), null);
  // A refused metrics read does not override a good location read.
  assert.equal(evaluateGoogleAccess({ authRevoked: false, location: location(), verification: null, metricsError: { category: 'AUTHORIZATION', httpStatus: 403, message: 'x' } })?.state, 'verified');
});

test('gate: only verified (or not yet checked) runs background work; gate off = old behaviour', () => {
  assert.equal(googleAccessAllows({ googleConnected: true, googleAccess: { state: 'verified' } }), true);
  assert.equal(googleAccessAllows({ googleConnected: true }), true, 'connected before the check existed');
  for (const state of ['checking', 'limited', 'blocked']) {
    assert.equal(googleAccessAllows({ googleConnected: true, googleAccess: { state } }), false, state);
    assert.equal(googleAccessAllows({ googleConnected: true, googleAccess: { state } }, false), true, `${state} with gate off`);
  }
  assert.equal(googleAccessAllows({ googleConnected: false, googleAccess: { state: 'verified' } }), false);
});

test('owner copy: every problem has a title, steps, and Reconnect where reconnecting fixes it', () => {
  const blocked = googleAccessCopy('blocked', 'no_permission');
  assert.match(blocked!.title, /refused/);
  assert.equal(blocked!.reconnect, true);
  assert.ok(blocked!.steps.some((s) => /Owner or Manager/.test(s)));
  assert.equal(googleAccessCopy('limited', 'verification_pending')!.reconnect, false);
  assert.equal(googleAccessCopy('verified', null), null);
  assert.ok(googleAccessCopy('checking', null)!.title);
});
