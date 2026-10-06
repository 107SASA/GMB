/**
 * Inbox rules and route guards. No database and no WhatsApp sends.
 * Run with: node --experimental-strip-types --test tests/integration/inbox-rules.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  duplicateClientKey,
  matchesInboxFilter,
  messageKind,
  outboundBlockedReason,
  ownershipLabel,
  scoreBand,
  sessionWindowOpen,
} from '../../src/services/inbox/inboxRules.ts';
import { isHumanOwned, salesReplyBlockedReason } from '../../src/services/agentHandoff/isHumanOwned.ts';

const hour = 60 * 60 * 1000;

test('customer-service window is open only for an inbound reply inside 24 hours', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  assert.equal(sessionWindowOpen(null, now), false);
  assert.equal(sessionWindowOpen(new Date(now.getTime() - 25 * hour), now), false);
  assert.equal(sessionWindowOpen(new Date(now.getTime() - 23 * hour), now), true);
});

test('score bands match the existing lead bands', () => {
  assert.equal(scoreBand(10), 'COLD');
  assert.equal(scoreBand(26), 'WARM');
  assert.equal(scoreBand(51), 'HOT');
  assert.equal(scoreBand(76), 'READY');
});

test('ownership labels come from stored lead state', () => {
  assert.equal(ownershipLabel({ humanHandoffActive: true }), 'Human Owned');
  assert.equal(ownershipLabel({ currentAgent: 'DEMO' }), 'Demo Scheduled');
  assert.equal(ownershipLabel({ nurtureStatus: 'ACTIVE', currentAgent: 'SALES' }), 'Nurturing');
  assert.equal(ownershipLabel({ currentStage: 'CUSTOMER' }), 'Customer');
  assert.equal(ownershipLabel({ currentStage: 'DO_NOT_CONTACT' }), 'Do not contact');
  assert.equal(ownershipLabel({}, 'completed'), 'Resolved');
  assert.equal(ownershipLabel({}), 'AI Active');
});

test('filters select unread, mine, human, demo, customers, and resolved', () => {
  const base = { unread: false, status: 'active', currentAgent: 'SALES', nurtureStatus: 'ACTIVE', assignedUserId: 'sam' };
  assert.equal(matchesInboxFilter({ ...base, unread: true }, 'unread'), true);
  assert.equal(matchesInboxFilter(base, 'mine', 'sam'), true);
  assert.equal(matchesInboxFilter(base, 'mine', 'other'), false);
  assert.equal(matchesInboxFilter({ ...base, assignedUserId: null, currentAgent: 'HUMAN', humanHandoffActive: true }, 'unassigned'), true);
  assert.equal(matchesInboxFilter({ ...base, currentAgent: 'HUMAN', humanHandoffActive: true }, 'human'), true);
  assert.equal(matchesInboxFilter({ ...base, currentAgent: 'DEMO', intent: 'DEMO_INTEREST' }, 'demo'), true);
  assert.equal(matchesInboxFilter({ ...base, currentStage: 'CUSTOMER' }, 'customers'), true);
  assert.equal(matchesInboxFilter({ ...base, status: 'completed' }, 'resolved'), true);
  assert.equal(matchesInboxFilter(base, 'ai'), true);
});

test('do-not-contact and opt-out block outbound, including templates', () => {
  assert.equal(outboundBlockedReason({ currentStage: 'DO_NOT_CONTACT' }), 'do-not-contact');
  assert.equal(outboundBlockedReason({ nurtureStatus: 'OPTED_OUT' }), 'opted-out');
  assert.equal(outboundBlockedReason({ nurtureStatus: 'STOPPED' }), 'opted-out');
  assert.equal(outboundBlockedReason({ currentAgent: 'SALES', nurtureStatus: 'ACTIVE' }), null);
});

test('a repeated client key is a duplicate and agent messages without a sender stay AI', () => {
  assert.equal(duplicateClientKey([{ clientKey: 'abc' }], 'abc'), true);
  assert.equal(duplicateClientKey([{ clientKey: 'abc' }], 'new'), false);
  assert.equal(duplicateClientKey([], null), false);
  assert.equal(messageKind('lead'), 'customer');
  assert.equal(messageKind('agent', 'human'), 'human');
  assert.equal(messageKind('agent'), 'ai');
});

test('human ownership stops the existing sales outbound path', () => {
  const human = { currentAgent: 'HUMAN' as const, humanHandoff: { active: true } };
  assert.equal(isHumanOwned(human), true);
  assert.equal(salesReplyBlockedReason(human), 'human-owned');
  assert.equal(salesReplyBlockedReason({ currentStage: 'DO_NOT_CONTACT', nurtureStatus: 'ACTIVE', currentAgent: 'SALES', humanHandoff: { active: false } }), 'opted-out-or-do-not-contact');
});

test('inbox routes authorize before any conversation mutation', () => {
  const files = [
    '../../src/app/api/admin/inbox/conversations/route.ts',
    '../../src/app/api/admin/inbox/conversations/[id]/route.ts',
    '../../src/app/api/admin/inbox/conversations/[id]/[action]/route.ts',
    '../../src/app/api/admin/inbox/templates/route.ts',
    '../../src/app/api/admin/inbox/team/route.ts',
    '../../src/app/api/admin/inbox/settings/route.ts',
  ];
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(source.includes('requireSuperAdmin'), file);
    assert.ok(source.indexOf('requireSuperAdmin') < source.indexOf('return NextResponse'), file);
  }
});

test('human send reuses the existing WhatsApp path and refuses a closed window', () => {
  const source = fs.readFileSync(new URL('../../src/services/inbox/platformInbox.ts', import.meta.url), 'utf8');
  const send = source.slice(source.indexOf('export async function sendInboxMessage'), source.indexOf('export async function takeOverInbox'));
  assert.ok(send.indexOf('outboundBlockedReason') < send.indexOf('sendOutboundMessage'));
  assert.ok(send.indexOf('duplicateClientKey') < send.indexOf('sendOutboundMessage'));
  assert.ok(send.indexOf('sessionWindowOpen') < send.indexOf('sendOutboundMessage'));
  assert.ok(send.includes('sendTemplateMessage'));
  assert.ok(send.indexOf('if (!result.success)') < send.indexOf('messages.push'));
  assert.equal(send.includes('graph.facebook.com'), false);
  assert.equal(send.includes('META_WHATSAPP_ACCESS_TOKEN'), false);
  assert.match(send, /customer-service window is closed/);
});

test('takeover, return, resolve, and notes stay on the existing lead records', () => {
  const source = fs.readFileSync(new URL('../../src/services/inbox/platformInbox.ts', import.meta.url), 'utf8');
  const takeover = source.slice(source.indexOf('export async function takeOverInbox'), source.indexOf('export async function returnInboxToAi'));
  assert.ok(takeover.includes("setLeadOwnership"));
  assert.ok(takeover.includes("'HUMAN'"));
  assert.ok(takeover.includes("'humanHandoff.active': true"));
  const back = source.slice(source.indexOf('export async function returnInboxToAi'), source.indexOf('export async function assignInbox'));
  assert.ok(back.includes('releaseFromHuman'));
  assert.equal(back.includes('followUpsSent = 0'), false);
  const resolve = source.slice(source.indexOf('export async function resolveInbox'), source.indexOf('export async function saveInboxNotes'));
  assert.ok(resolve.includes("'completed'"));
  assert.ok(resolve.includes('OPTED_OUT'));
  const notes = source.slice(source.indexOf('export async function saveInboxNotes'), source.indexOf('export async function inboxTeam'));
  assert.equal(notes.includes('sendOutboundMessage'), false);
  assert.ok(notes.includes('notes'));
});

test('the inbox screen keeps the required empty states and does not call Meta from the browser', () => {
  const page = fs.readFileSync(new URL('../../src/app/admin/inbox/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('Select a conversation to start'));
  assert.ok(page.includes('No WhatsApp conversations yet.'));
  assert.ok(page.includes('No conversations require your attention.'));
  assert.ok(page.includes('No conversations found.'));
  assert.ok(page.includes('Message failed to send'));
  assert.ok(page.includes('WhatsApp customer-service window is closed. Select an approved template to continue.'));
  assert.equal(page.includes('graph.facebook.com'), false);
  assert.equal(page.includes('/api/admin/inbox/'), true);
});
