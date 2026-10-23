/**
 * Review-reply mode rules — pure rules (lib/reviewReplyConsent.ts).
 * Run: node --experimental-strip-types --test tests/integration/review-reply-consent.test.ts
 * The workflow (auto by default, manual = drafts only, no Google call) runs
 * against a database in tests/workflow/review-auto-publish.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isAutoPublishActive,
  newBusinessReviewReplySettings,
  replyModeUpdate,
} from '../../src/lib/reviewReplyConsent.ts';

const OWNER = '665f1c2a9b1e8a0012345678';

test('new businesses start in auto-reply mode', () => {
  const s = newBusinessReviewReplySettings();
  assert.deepEqual(s, { mode: 'auto', tone: 'Professional' });
  assert.equal(isAutoPublishActive(s), true);
});

test('auto mode is active with or without a recorded opt-in; manual never is', () => {
  assert.equal(isAutoPublishActive({ mode: 'auto' }), true);
  assert.equal(isAutoPublishActive({ mode: 'auto', autoPublishConsentAt: new Date(), autoPublishConsentBy: OWNER }), true);
  assert.equal(isAutoPublishActive({ mode: 'auto', autoPublishConsentAt: '2026-10-10T00:00:00Z', autoPublishConsentBy: 'default:new-business' }), true, 'Oct 2026 default-on businesses');
  assert.equal(isAutoPublishActive({ mode: 'manual', autoPublishConsentAt: new Date(), autoPublishConsentBy: OWNER }), false);
  assert.equal(isAutoPublishActive({ mode: 'manual' }), false);
  assert.equal(isAutoPublishActive(null), false);
  assert.equal(isAutoPublishActive(undefined), false);
});

test('the schema default matches the new-business default', () => {
  assert.match(fs.readFileSync('src/models/Business.ts', 'utf8'), /mode: \{ type: String, enum: \['manual', 'auto'\], default: 'auto' \}/);
});

test('owner turning auto on records the time + the owner\'s user id', () => {
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

test('re-saving auto keeps the original record; switching to manual clears it', () => {
  assert.deepEqual(replyModeUpdate({ mode: 'auto', wasAuto: true, ownerUserId: OWNER }), { $set: { 'reviewReplySettings.mode': 'auto' } });
  assert.deepEqual(replyModeUpdate({ mode: 'manual', wasAuto: true, ownerUserId: OWNER }), {
    $set: { 'reviewReplySettings.mode': 'manual' },
    $unset: { 'reviewReplySettings.autoPublishConsentAt': 1, 'reviewReplySettings.autoPublishConsentBy': 1 },
  });
});

test('the opt-in record never names anyone but a real owner id', () => {
  for (const ownerUserId of ['', '  ', 'default:new-business', 'default:anything']) {
    assert.throws(() => replyModeUpdate({ mode: 'auto', wasAuto: false, ownerUserId }), /owner/);
  }
});

test('every Business.create path uses the shared default; the route saves through replyModeUpdate', () => {
  for (const file of ['src/app/api/business/route.ts', 'src/app/api/business/add-workspace/route.ts', 'src/app/api/onboarding/route.ts', 'src/lib/shadowAccount.ts']) {
    assert.match(fs.readFileSync(file, 'utf8'), /reviewReplySettings: newBusinessReviewReplySettings\(\)/, file);
  }
  const route = fs.readFileSync('src/app/api/reviews/reply-settings/route.ts', 'utf8');
  assert.match(route, /replyModeUpdate\(\{ mode, tone, wasAuto, ownerUserId: String\(ctx\.userId\) \}\)/);
  assert.match(route, /mode === 'auto' && !wasAuto \? await queueUnrepliedBacklog\(/);
});

test('auto-publish and the old-review backlog both gate on isAutoPublishActive', () => {
  assert.match(fs.readFileSync('src/services/reviews/autoReply.ts', 'utf8'), /!isAutoPublishActive\(business\?\.reviewReplySettings\)\) return \{ drafted: d\.status, published: null \}/);
  // syncReviews only queues reviews older than 30 days when auto-publish is active.
  const sync = fs.readFileSync('src/services/reviews/syncReviews.ts', 'utf8');
  assert.match(sync, /const auto = isAutoPublishActive\(business\?\.reviewReplySettings\);/);
  assert.match(sync, /\.filter\(\(\{ saved \}\) => auto \|\| new Date\(/);
});
