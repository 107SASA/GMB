/**
 * Demo scheduling rules. No Google calls, no database, no WhatsApp.
 * Run: node --experimental-strip-types --test tests/integration/demo-scheduling.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALENDAR_SCOPES,
  alternativeSlots,
  assignSalesperson,
  bookingIdempotencyKey,
  classifyTokenRefreshFailure,
  confirmationCopy,
  defaultDemoSchedule,
  parseRequestedDateTime,
  publicCalendarConnection,
  reminderInstants,
  reminderShouldSend,
  slotFitsSchedule,
  validateDemoSchedule,
  zonedLocalToUtc,
} from '../../src/services/calendar/demoScheduling.ts';

const tz = 'Asia/Kolkata';

test('parses 10:30 today and 10.30 today in Asia/Kolkata', () => {
  const now = new Date('2026-10-04T02:00:00Z'); // 07:30 IST
  const a = parseRequestedDateTime('10:30 today', now, tz);
  const b = parseRequestedDateTime('10.30 today', now, tz);
  assert.ok(a && b);
  assert.equal(a!.time, '10:30');
  assert.equal(b!.time, '10:30');
  assert.equal(a!.date, '2026-10-04');
  assert.equal(a!.startUtc.toISOString(), zonedLocalToUtc('2026-10-04', '10:30', tz).toISOString());
  assert.equal(a!.startUtc.toISOString(), '2026-10-04T05:00:00.000Z');
});

test('rejects a time outside working hours and too soon', () => {
  const config = defaultDemoSchedule();
  const now = new Date('2026-10-05T04:00:00Z'); // Monday 09:30 IST
  const evening = parseRequestedDateTime('21:00 today', now, tz)!;
  assert.equal(slotFitsSchedule(evening, now, config), 'outside-working-hours');
  const soon = parseRequestedDateTime('10:00 today', now, tz)!;
  assert.equal(slotFitsSchedule(soon, now, config), 'too-soon');
});

test('assigns the first available salesperson and round-robins the rest', () => {
  const people = [
    { userId: 'a', email: 'a@x.com', calendarId: 'primary', busy: true },
    { userId: 'b', email: 'b@x.com', calendarId: 'primary', busy: false },
    { userId: 'c', email: 'c@x.com', calendarId: 'primary', busy: false },
  ];
  assert.equal(assignSalesperson(people, 'first-available', 0).person?.userId, 'b');
  const first = assignSalesperson(people, 'round-robin', 0);
  const second = assignSalesperson(people, 'round-robin', first.nextCursor);
  assert.equal(first.person?.userId, 'b');
  assert.equal(second.person?.userId, 'c');
  assert.equal(assignSalesperson(people.map((p) => ({ ...p, busy: true })), 'first-available', 0).person, null);
});

test('offers later slots when every salesperson is busy at the requested time', () => {
  const config = { ...defaultDemoSchedule(), bufferMinutes: 0 };
  const now = new Date('2026-10-05T02:00:00Z');
  const around = zonedLocalToUtc('2026-10-05', '10:30', tz);
  const busy = [{ start: around, end: new Date(around.getTime() + 30 * 60 * 1000) }];
  const alts = alternativeSlots({
    now,
    config,
    around,
    busyByUser: [{ userId: 'a', busy }],
    limit: 2,
  });
  assert.equal(alts.length, 2);
  assert.equal(alts[0].time, '11:00');
  assert.equal(alts[1].time, '11:30');
});

test('buffer blocks the slot immediately after a busy block', () => {
  const config = { ...defaultDemoSchedule(), bufferMinutes: 15 };
  const now = new Date('2026-10-05T02:00:00Z');
  const around = zonedLocalToUtc('2026-10-05', '10:00', tz);
  const busy = [{ start: around, end: new Date(around.getTime() + 30 * 60 * 1000) }];
  const alts = alternativeSlots({ now, config, around, busyByUser: [{ userId: 'a', busy }], limit: 1 });
  assert.notEqual(alts[0]?.time, '10:30');
});

test('duplicate booking key is stable and confirmation requires a real Meet URL', () => {
  const start = new Date('2026-10-04T05:00:00.000Z');
  assert.equal(bookingIdempotencyKey('lead-1', start), bookingIdempotencyKey('lead-1', start));
  assert.equal(confirmationCopy({ whenLabel: 'today at 10:30 AM', meetingLink: '' }), null);
  assert.match(confirmationCopy({ whenLabel: 'today at 10:30 AM', meetingLink: 'https://meet.google.com/abc-defg-hij' }) || '', /meet\.google\.com\/abc-defg-hij/);
});

test('reminders are 24h, 1h and 15m, once, and stop after cancel or reschedule', () => {
  const start = new Date('2026-10-06T05:00:00.000Z');
  const now = new Date('2026-10-04T05:00:00.000Z');
  const due = reminderInstants(start, [24 * 60, 60, 15], now);
  assert.deepEqual(due.map((row) => row.leadMinutes), [24 * 60, 60, 15]);
  assert.equal(reminderInstants(start, [15], new Date(start.getTime() - 5 * 60 * 1000)).length, 0);
  assert.equal(reminderShouldSend({ bookingStatus: 'Confirmed', humanOwned: false, optedOut: false }), true);
  assert.equal(reminderShouldSend({ bookingStatus: 'Cancelled', humanOwned: false, optedOut: false }), false);
  assert.equal(reminderShouldSend({ bookingStatus: 'Confirmed', humanOwned: true, optedOut: false }), false);
  assert.equal(reminderShouldSend({
    bookingStatus: 'Confirmed',
    humanOwned: false,
    optedOut: false,
    currentBookingStart: '2026-10-06T06:00:00.000Z',
    reminderStart: '2026-10-06T05:00:00.000Z',
  }), false);
});

test('oauth connection view hides tokens and a revoked refresh is not transient', () => {
  assert.ok(CALENDAR_SCOPES.includes('https://www.googleapis.com/auth/calendar.events'));
  assert.ok(CALENDAR_SCOPES.includes('https://www.googleapis.com/auth/calendar.freebusy'));
  const view = publicCalendarConnection({
    userId: 'user-1',
    googleEmail: 'rep@growwmatics.com',
    status: 'active',
    refreshTokenEnc: 'secret-refresh',
    accessTokenEnc: 'secret-access',
  });
  assert.equal('refreshTokenEnc' in view, false);
  assert.equal('accessTokenEnc' in view, false);
  assert.equal(view.connected, true);
  assert.equal(classifyTokenRefreshFailure(400, 'invalid_grant'), 'revoked');
  assert.equal(classifyTokenRefreshFailure(503, ''), 'transient');
  assert.match(validateDemoSchedule({ ...defaultDemoSchedule(), demoDurationMinutes: 0 }) || '', /duration/i);
  assert.match(validateDemoSchedule({ ...defaultDemoSchedule(), timezone: 'Not/AZone' }) || '', /timezone/i);
});
