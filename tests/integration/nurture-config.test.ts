/**
 * Nurture schedule rules. No database and no sends.
 * Run with: node --experimental-strip-types --test tests/integration/nurture-config.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildTimingSnapshot,
  defaultNurtureSchedule,
  followUpDelayMinutes,
  genericFollowUpSkipReason,
  isWithinQuietHours,
  minutesUntilSendable,
  nurtureMutationAllowed,
  onlyIfNoReplyBlocks,
  proactiveCohortDecision,
  snapshotFromStoredAgent,
  timingForSequence,
  validateNurtureSchedule,
} from '../../src/services/nurture/nurtureSchedule.ts';

test('default schedule matches the verified production timing', () => {
  const schedule = defaultNurtureSchedule();
  assert.equal(schedule.rolloutPercentage, 0);
  assert.deepEqual(schedule.leadIdAllowlist, []);
  assert.equal(schedule.firstMessage.delayMinutes, 2);
  assert.equal(schedule.followUps[0].delayMinutes, 24 * 60);
  assert.equal(schedule.followUps[1].delayMinutes, 72 * 60);
  assert.equal(schedule.followUps[0].onlyIfNoReply, true);
  assert.equal(schedule.followUps[1].onlyIfNoReply, true);
  assert.equal(schedule.quietHours.enabled, false);
  assert.equal(validateNurtureSchedule(schedule), null);
});

test('stored delayHours still means 24h then 72h when delayMinutes is absent', () => {
  assert.equal(followUpDelayMinutes({ delayHours: 24 }), 24 * 60);
  assert.equal(followUpDelayMinutes({ delayHours: 72 }), 72 * 60);
  const snap = snapshotFromStoredAgent({
    followUps: [
      { delayHours: 24, onlyIfNoReply: true },
      { delayHours: 72, onlyIfNoReply: true },
    ],
  });
  assert.equal(snap.followUps[0].delayMinutes, 24 * 60);
  assert.equal(snap.followUps[1].delayMinutes, 72 * 60);
});

test('unauthorized role cannot update configuration', () => {
  assert.equal(nurtureMutationAllowed(null), false);
  assert.equal(nurtureMutationAllowed('CLIENT'), false);
  assert.equal(nurtureMutationAllowed('SUPER_ADMIN'), true);
  const route = fs.readFileSync(new URL('../../src/app/api/admin/nurture-config/route.ts', import.meta.url), 'utf8');
  const preview = fs.readFileSync(new URL('../../src/app/api/admin/nurture-config/preview/route.ts', import.meta.url), 'utf8');
  assert.ok(route.indexOf('requireSuperAdmin') < route.indexOf('saveNurtureAdminView'));
  assert.ok(preview.includes('requireSuperAdmin'));
  assert.equal(preview.includes('SalesConversation.create'), false);
});

test('invalid delay, rollout, and timezone are rejected before any write', () => {
  const base = defaultNurtureSchedule();
  assert.match(validateNurtureSchedule({ ...base, firstMessage: { enabled: true, delayMinutes: 0 } }) || '', /at least 1 minute/);
  assert.match(validateNurtureSchedule({ ...base, rolloutPercentage: 101 }) || '', /0 to 100/);
  assert.match(validateNurtureSchedule({ ...base, rolloutPercentage: -1 }) || '', /0 to 100/);
  assert.match(validateNurtureSchedule({ ...base, timezone: 'Not/AZone' }) || '', /timezone/i);
  assert.match(validateNurtureSchedule({
    ...base,
    followUps: [{ id: 'a', enabled: true, delayMinutes: 0, onlyIfNoReply: true }],
  }) || '', /at least 1 minute/);
  assert.match(validateNurtureSchedule({ ...base, maxNurtureMessages: 1000 }) || '', /Maximum nurture messages/);
});

test('0% rollout selects no proactive lead and 100% allows an eligible lead', () => {
  assert.equal(proactiveCohortDecision({
    safetyBlocked: false, leadId: 'a', allowlist: [], rolloutPercentage: 0, bucket: 0,
  }).allowed, false);
  assert.equal(proactiveCohortDecision({
    safetyBlocked: false, leadId: 'a', allowlist: [], rolloutPercentage: 100, bucket: 99,
  }).allowed, true);
});

test('allowlist includes a safe lead and still blocks an ineligible lead', () => {
  assert.equal(proactiveCohortDecision({
    safetyBlocked: false, leadId: 'lead-1', allowlist: ['lead-1'], rolloutPercentage: 0, bucket: 50,
  }).allowed, true);
  const blocked = proactiveCohortDecision({
    safetyBlocked: true, leadId: 'lead-1', allowlist: ['lead-1'], rolloutPercentage: 100, bucket: 0,
  });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /do not override/);
});

test('a reply blocks an onlyIfNoReply follow-up', () => {
  const firstSentAt = new Date('2026-10-04T04:56:08Z');
  const lastLeadReplyAt = new Date('2026-10-04T04:57:42Z');
  assert.equal(onlyIfNoReplyBlocks({ onlyIfNoReply: true, firstSentAt, lastLeadReplyAt }), true);
  assert.equal(onlyIfNoReplyBlocks({ onlyIfNoReply: false, firstSentAt, lastLeadReplyAt }), false);
  assert.equal(onlyIfNoReplyBlocks({ onlyIfNoReply: true, firstSentAt, lastLeadReplyAt: null }), false);
});

test('overnight quiet hours delay until the morning window', () => {
  const quiet = { enabled: true, start: '21:00', end: '09:00' };
  const night = new Date('2026-10-04T16:00:00Z'); // 21:30 Asia/Kolkata
  assert.equal(isWithinQuietHours(night, quiet, 'Asia/Kolkata'), true);
  const wait = minutesUntilSendable({
    now: night,
    quietHours: quiet,
    timezone: 'Asia/Kolkata',
    minimumMessageGapMinutes: 0,
  });
  assert.equal(wait, 11 * 60 + 30);
  const morning = new Date('2026-10-04T04:30:00Z'); // 10:00 Asia/Kolkata
  assert.equal(isWithinQuietHours(morning, quiet, 'Asia/Kolkata'), false);
  assert.equal(isWithinQuietHours(night, { ...quiet, enabled: false }, 'Asia/Kolkata'), false);
});

test('human handoff, do-not-contact, and customer block generic nurture', () => {
  assert.equal(genericFollowUpSkipReason({ humanHandoffActive: true }), 'human-owned');
  assert.equal(genericFollowUpSkipReason({ currentStage: 'DO_NOT_CONTACT', nurtureStatus: 'ACTIVE' }), 'opted-out-or-do-not-contact');
  assert.equal(genericFollowUpSkipReason({ currentStage: 'CUSTOMER', currentAgent: 'IN_HOUSE' }), 'already-customer');
  assert.equal(genericFollowUpSkipReason({
    intent: 'EXPLORING',
    nextBestAction: 'SHOW_VALUE',
    currentStage: 'NURTURING',
    currentAgent: 'SALES',
    nurtureStatus: 'ACTIVE',
  }), null);
});

test('DEMO_INTEREST plus SCHEDULE_DEMO does not fall through to generic nurture', () => {
  assert.equal(genericFollowUpSkipReason({
    intent: 'DEMO_INTEREST',
    nextBestAction: 'SCHEDULE_DEMO',
    currentStage: 'NURTURING',
    currentAgent: 'SALES',
    nurtureStatus: 'ACTIVE',
    humanHandoffActive: false,
  }), 'demo-intent-owns-next-step');
});

test('a running sequence keeps its version when the latest config changes', () => {
  const started = snapshotFromStoredAgent({
    nurtureConfigVersion: 1,
    firstMessage: { delayMinutes: 2 },
    followUps: [{ delayHours: 24, onlyIfNoReply: true }, { delayHours: 72, onlyIfNoReply: true }],
  });
  const latest = buildTimingSnapshot({
    ...defaultNurtureSchedule(),
    firstMessage: { enabled: true, delayMinutes: 5 },
    followUps: [
      { id: 'a', enabled: true, delayMinutes: 12 * 60, onlyIfNoReply: true },
      { id: 'b', enabled: true, delayMinutes: 48 * 60, onlyIfNoReply: true },
      { id: 'c', enabled: true, delayMinutes: 7 * 24 * 60, onlyIfNoReply: true },
    ],
  }, 2);
  const kept = timingForSequence(started, latest);
  assert.equal(kept.version, 1);
  assert.equal(kept.firstMessage.delayMinutes, 2);
  assert.equal(kept.followUps[1].delayMinutes, 72 * 60);
  latest.firstMessage.delayMinutes = 9;
  assert.equal(kept.firstMessage.delayMinutes, 2);
  assert.equal(timingForSequence(null, latest).version, 2);
  assert.equal(timingForSequence(null, latest).firstMessage.delayMinutes, 9);
});
