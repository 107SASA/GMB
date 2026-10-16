/**
 * Review-reply auto-publish consent — pure rules (lib/reviewReplyConsent.ts).
 * Run: node --experimental-strip-types --test tests/integration/review-reply-consent.test.ts
 * The workflow (drafts only, no Google call, owner opt-in publishes) runs
 * against a database in tests/workflow/review-auto-publish.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_AUTO_REPLY_CONSENT_BY,
  isAutoPublishActive,
  newBusinessReviewReplySettings,
  replyModeUpdate,
} from '../../src/lib/reviewReplyConsent.ts';

const OWNER = '665f1c2a9b1e8a0012345678';

test('new businesses start in manual mode with no consent recorded', () => {
  const s = newBusinessReviewReplySettings();
  assert.deepEqual(s, { mode: 'manual', tone: 'Professional' });
  assert.equal(isAutoPublishActive(s), false);
});

test('synthetic new-business consent is never treated as the owner\'s consent', () => {
  assert.equal(isAutoPublishActive({ mode: 'auto', autoPublishConsentAt: new Date(), autoPublishConsentBy: DEFAULT_AUTO_REPLY_CONSENT_BY }), false);
  assert.equal(isAutoPublishActive({ mode: 'auto', autoPublishConsentAt: '2026-10-10T00:00:00Z', autoPublishConsentBy: 'default:new-business' }), false);
});

test('only auto mode + recorded owner consent is active', () => {
  assert.equal(isAutoPublishActive({ mode: 'auto', autoPublishConsentAt: new Date(), autoPublishConsentBy: OWNER }), true);
  assert.equal(isAutoPublishActive({ mode: 'auto' }), false, 'legacy auto without consent');
  assert.equal(isAutoPublishActive({ mode: 'manual', autoPublishConsentAt: new Date(), autoPublishConsentBy: OWNER }), false);
  assert.equal(isAutoPublishActive(null), false);
  assert.equal(isAutoPublishActive(undefined), false);
});

test('owner opt-in records consent as now + the owner\'s user id', () => {
  const now = new Date('2026-10-16T10:00:00Z');
  const u = replyModeUpdate({ mode: 'auto', tone: 'Friendly', wasAuto: false, ownerUserId: OWNER, now });
  assert.deepEqual(u, {
    $set: {
      'reviewReplySettings.mode': 'auto',
      'reviewReplySettings.autoPublishConsentAt': now,
      'reviewReplySettings.autoPublishConsentBy': OWNER,
      'reviewReplySettings.tone': 'Friendly',
    },
  });
});

test('re-saving auto keeps the original consent; switching to manual clears it', () => {
  assert.deepEqual(replyModeUpdate({ mode: 'auto', wasAuto: true, ownerUserId: OWNER }), { $set: { 'reviewReplySettings.mode': 'auto' } });
  assert.deepEqual(replyModeUpdate({ mode: 'manual', wasAuto: true, ownerUserId: OWNER }), {
    $set: { 'reviewReplySettings.mode': 'manual' },
    $unset: { 'reviewReplySettings.autoPublishConsentAt': 1, 'reviewReplySettings.autoPublishConsentBy': 1 },
  });
});

test('consent is never recorded without a real owner id', () => {
  for (const ownerUserId of ['', '  ', DEFAULT_AUTO_REPLY_CONSENT_BY, 'default:anything']) {
    assert.throws(() => replyModeUpdate({ mode: 'auto', wasAuto: false, ownerUserId }), /owner/);
  }
});

test('every Business.create path uses the manual default; nothing writes the synthetic marker', () => {
  for (const file of ['src/app/api/business/route.ts', 'src/app/api/business/add-workspace/route.ts', 'src/app/api/onboarding/route.ts', 'src/lib/shadowAccount.ts']) {
    assert.match(fs.readFileSync(file, 'utf8'), /reviewReplySettings: newBusinessReviewReplySettings\(\)/, file);
  }
  const route = fs.readFileSync('src/app/api/reviews/reply-settings/route.ts', 'utf8');
  assert.match(route, /replyModeUpdate\(\{ mode, tone, wasAuto, ownerUserId: String\(ctx\.userId\) \}\)/);
  const consent = fs.readFileSync('src/lib/reviewReplyConsent.ts', 'utf8');
  assert.equal((consent.match(/autoPublishConsentBy: DEFAULT_AUTO_REPLY_CONSENT_BY/g) || []).length, 0, 'the marker is only compared, never written');
});

test('auto-publish and the old-review backlog both gate on isAutoPublishActive', () => {
  assert.match(fs.readFileSync('src/services/reviews/autoReply.ts', 'utf8'), /!isAutoPublishActive\(business\?\.reviewReplySettings\)\) return \{ drafted: d\.status, published: null \}/);
  // syncReviews only queues reviews older than 30 days when auto-publish is active.
  const sync = fs.readFileSync('src/services/reviews/syncReviews.ts', 'utf8');
  assert.match(sync, /const auto = isAutoPublishActive\(business\?\.reviewReplySettings\);/);
  assert.match(sync, /\.filter\(\(\{ saved \}\) => auto \|\| new Date\(/);
});
