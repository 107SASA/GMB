/**
 * Prospect menu, demo copy, and scheduling-quiet rules.
 * No database, no Google, no WhatsApp sends.
 * Run: node --experimental-strip-types --test tests/integration/prospect-choice.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEW_LEAD_MENU,
  REPORT_READY_MENU,
  SCHEDULE_HANDOFF_ONCE,
  alternativesCopy,
  applyReportIntake,
  classifyProspectChoice,
  confirmsSingleSlot,
  factsFromStored,
  menuFor,
  reportIntakeQuestion,
  schedulingReplyAllowed,
  slotAvailableCopy,
} from '../../src/services/whatsapp/prospectChoice.ts';
import { parseDemoTimeRequest } from '../../src/services/calendar/demoScheduling.ts';

test('A new Hi is the two-option menu, not a handoff', () => {
  assert.equal(classifyProspectChoice('Hi', 'new'), 'unknown');
  assert.match(menuFor('new'), /Book a Demo/);
  assert.match(menuFor('new'), /Free Google Business Profile Report/);
  assert.equal(menuFor('new'), NEW_LEAD_MENU);
  assert.doesNotMatch(NEW_LEAD_MENU, /team member will/);
});

test('B natural demo language asks for a time, and 1 means demo', () => {
  assert.equal(classifyProspectChoice('I want a demo', 'new'), 'demo');
  assert.equal(classifyProspectChoice('book demo', 'new'), 'demo');
  assert.equal(classifyProspectChoice('yes demo', 'new'), 'demo');
  assert.equal(classifyProspectChoice('1', 'new'), 'demo');
  assert.equal(classifyProspectChoice('2', 'new'), 'report');
  assert.equal(classifyProspectChoice('I want free report', 'new'), 'report');
});

test('C and D an existing report routes demo and view without a new report', () => {
  assert.equal(classifyProspectChoice('I want a demo', 'report-ready'), 'demo');
  assert.equal(classifyProspectChoice('demo', 'report-ready'), 'demo');
  assert.equal(classifyProspectChoice('2', 'report-ready'), 'demo');
  assert.equal(classifyProspectChoice('show report', 'report-ready'), 'view-report');
  assert.equal(classifyProspectChoice('1', 'report-ready'), 'view-report');
  assert.match(REPORT_READY_MENU, /View Report/);
  assert.match(REPORT_READY_MENU, /Book a Demo/);
});

test('E tomorrow 11 AM parses to 11:00', () => {
  const now = new Date('2026-10-06T04:00:00.000Z');
  const slot = parseDemoTimeRequest('tomorrow 11 AM', now, 'Asia/Kolkata');
  assert.ok(slot);
  assert.equal(slot!.time, '11:00');
  assert.equal(slot!.date, '2026-10-07');
  const afternoon = parseDemoTimeRequest('Friday afternoon', now, 'Asia/Kolkata');
  assert.equal(afternoon?.time, '14:00');
});

test('F and G slot copy uses real times and never the old forwarded line', () => {
  assert.equal(slotAvailableCopy('11:00 AM'), '11:00 AM is available. Shall I book it?');
  const alternatives = alternativesCopy('10:30 AM', ['11:00 AM', '11:30 AM', '12:00 PM']);
  assert.match(alternatives, /11:00 AM/);
  assert.match(alternatives, /11:30 AM/);
  assert.match(alternatives, /12:00 PM/);
  assert.doesNotMatch(alternatives, /forwarded/);
  assert.doesNotMatch(alternatives, /find a time that works/);
});

test('H a single offered slot is confirmed only by an explicit yes', () => {
  assert.equal(confirmsSingleSlot('Yes'), true);
  assert.equal(confirmsSingleSlot('book it'), true);
  assert.equal(confirmsSingleSlot('tomorrow 11'), false);
});

test('I and J the scheduling handoff is sent once and then the AI stays quiet', () => {
  assert.match(SCHEDULE_HANDOFF_ONCE, /team member help schedule/);
  assert.equal(schedulingReplyAllowed({ humanOwned: false, handoffAlreadySent: false }), true);
  assert.equal(schedulingReplyAllowed({ humanOwned: false, handoffAlreadySent: true }), false);
  assert.equal(schedulingReplyAllowed({ humanOwned: true, handoffAlreadySent: false }), false);
});

test('K stored business and location are not asked again', () => {
  const facts = factsFromStored({
    now: new Date('2026-10-06T08:00:00.000Z'),
    lead: { name: 'New User', businessType: '' },
    audit: {
      _id: 'audit-1',
      status: 'COMPLETED',
      businessName: 'Wagh Supermarket',
      city: 'Nashik',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  });
  assert.equal(facts.businessName, 'Wagh Supermarket');
  assert.equal(facts.location, 'Nashik');
  assert.equal(facts.reportStatus, 'completed');
  assert.equal(reportIntakeQuestion(facts), null);
  const partial = applyReportIntake('need-both', 'Mulsetu Agrotech, Nashik', {});
  assert.equal(partial.businessName, 'Mulsetu Agrotech');
  assert.equal(partial.location, 'Nashik');
  assert.equal(partial.question, null);
});

test('L a second delivery of the same inbound is not another automated reply', () => {
  assert.equal(schedulingReplyAllowed({ humanOwned: true, handoffAlreadySent: true }), false);
});
