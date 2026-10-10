/**
 * WhatsApp demo booking: reading the day a lead types, listing that day's times,
 * and picking the tapped or typed slot. No Google calls, no database, no WhatsApp.
 * Run: node --experimental-strip-types --test tests/integration/demo-slot-booking.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayProblem,
  defaultDemoSchedule,
  nextOpenDates,
  openSlotsOnDate,
  parseDemoDate,
  spreadSlots,
} from '../../src/services/calendar/demoScheduling.ts';
import {
  DAY_CHOICE_BUTTONS,
  MAX_LISTED_SLOTS,
  dateButtons,
  dayChoiceText,
  isOtherDateChoice,
  pickOfferedSlotIndex,
  slotListItems,
  slotOfferText,
} from '../../src/services/whatsapp/slotButtons.ts';

const tz = 'Asia/Kolkata';
// Saturday 10 October 2026, 10:30 IST.
const now = new Date('2026-10-10T05:00:00Z');
const asked = { expectingDate: true };

test('reads today, tomorrow and its misspellings, and day after tomorrow', () => {
  assert.equal(parseDemoDate('today', now, tz), '2026-10-10');
  assert.equal(parseDemoDate('Tomorrow', now, tz), '2026-10-11');
  for (const typo of ['tommorow', 'tomorow', 'tmrw', 'tmr']) assert.equal(parseDemoDate(typo, now, tz), '2026-10-11', typo);
  assert.equal(parseDemoDate('day after tomorrow', now, tz), '2026-10-12');
});

test('reads day and month names in any order, with ordinals and misspellings', () => {
  for (const text of ['2nd October', '2 oct', 'oct 2', 'October 2nd', '2nd of october', '2 ocotber', '2nd ocotor']) {
    assert.equal(parseDemoDate(text, now, tz), '2026-10-02', text);
  }
  assert.equal(parseDemoDate('12 october 10am', now, tz), '2026-10-12');
  assert.equal(parseDemoDate('15 Nov', now, tz), '2026-11-15');
  assert.equal(parseDemoDate('5 jan', now, tz), '2027-01-05', 'a month long past rolls to next year');
});

test('reads numeric dates day first', () => {
  assert.equal(parseDemoDate('12/10', now, tz), '2026-10-12');
  assert.equal(parseDemoDate('2/11/2026', now, tz), '2026-11-02');
  assert.equal(parseDemoDate('12-10', now, tz), null, 'dashes are only read as a date after asking for one');
  assert.equal(parseDemoDate('12-10', now, tz, asked), '2026-10-12');
  assert.equal(parseDemoDate('12.10', now, tz, asked), '2026-10-12');
  assert.equal(parseDemoDate('2026-10-14', now, tz), '2026-10-14');
  assert.equal(parseDemoDate('31/2', now, tz), null);
});

test('a bare day number counts only after the lead was asked for a date', () => {
  assert.equal(parseDemoDate('12', now, tz), null);
  assert.equal(parseDemoDate('12', now, tz, asked), '2026-10-12');
  assert.equal(parseDemoDate('12th', now, tz, asked), '2026-10-12');
  assert.equal(parseDemoDate('2', now, tz, asked), '2026-11-02', 'a day already gone this month means next month');
  assert.equal(parseDemoDate('on the 20th', now, tz, asked), '2026-10-20');
});

test('reads weekdays', () => {
  assert.equal(parseDemoDate('monday', now, tz), '2026-10-12');
  assert.equal(parseDemoDate('Fri', now, tz), '2026-10-16');
  assert.equal(parseDemoDate('saturday', now, tz), '2026-10-10');
  assert.equal(parseDemoDate('next saturday', now, tz), '2026-10-17');
});

test('ignores text without a date', () => {
  for (const text of ['I want to book a demo', 'hello', 'what is the price', 'budget 1-5 lakh', 'maybe later', 'my number 2', 'march on', 'decent 5']) {
    assert.equal(parseDemoDate(text, now, tz), null, text);
  }
});

test('dayProblem flags past, closed, and too-far days', () => {
  const config = defaultDemoSchedule();
  assert.equal(dayProblem('2026-10-09', now, config), 'past');
  assert.equal(dayProblem('2026-10-11', now, config), 'closed', 'Sunday is not a working day');
  assert.equal(dayProblem('2026-12-01', now, config), 'too-far');
  assert.equal(dayProblem('2026-10-12', now, config), null);
});

test('openSlotsOnDate lists every free time that day, and skips busy ones', () => {
  const config = { ...defaultDemoSchedule(), openingTime: '10:00', closingTime: '13:00', bufferMinutes: 0 };
  const busy = [{ start: new Date('2026-10-12T05:30:00Z'), end: new Date('2026-10-12T06:00:00Z') }]; // 11:00–11:30 IST
  const slots = openSlotsOnDate({ now, config, date: '2026-10-12', busyByUser: [{ userId: 'a', busy }] });
  assert.deepEqual(slots.map((slot) => slot.time), ['10:00', '10:30', '11:30', '12:00', '12:30']);
  assert.deepEqual(openSlotsOnDate({ now, config, date: '2026-10-11', busyByUser: [{ userId: 'a', busy: [] }] }), [], 'Sunday');
});

test('nextOpenDates skips closed days', () => {
  const config = defaultDemoSchedule();
  const dates = nextOpenDates({ now, config, after: '2026-10-10', busyByUser: [{ userId: 'a', busy: [] }], limit: 2 });
  assert.deepEqual(dates, ['2026-10-12', '2026-10-13']);
});

test('spreadSlots keeps the first and last times and spaces the rest', () => {
  const all = Array.from({ length: 16 }, (_, i) => i);
  const picked = spreadSlots(all, MAX_LISTED_SLOTS);
  assert.equal(picked.length, MAX_LISTED_SLOTS);
  assert.equal(picked[0], 0);
  assert.equal(picked[picked.length - 1], 15);
  assert.deepEqual(spreadSlots([1, 2], 9), [1, 2]);
});

test('day buttons and the time list fit WhatsApp limits', () => {
  assert.deepEqual(DAY_CHOICE_BUTTONS.map((button) => button.id), ['today', 'tomorrow', 'other-date']);
  const buttons = dateButtons(['2026-10-12', '2026-10-13', '2026-10-14']);
  assert.deepEqual(buttons.map((button) => button.title), ['Mon 12 Oct', 'Tue 13 Oct', 'Other date']);
  for (const button of buttons) assert.equal(parseDemoDate(button.id, now, tz) ?? button.id, button.id);

  const slots = Array.from({ length: 12 }, (_, i) => ({ date: '2026-10-12', time: `${String(10 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}` }));
  const items = slotListItems(slots);
  assert.equal(items.length, 10, '9 times plus Another day');
  assert.deepEqual(items[0], { id: '1', item: '10:00 AM', description: 'Mon 12 Oct' });
  assert.deepEqual(items[9], { id: 'other-date', item: 'Another day' });
  assert.ok(items.every((row) => row.item.length <= 24));
});

test('the text fallbacks never use numbers for the day choice', () => {
  assert.doesNotMatch(dayChoiceText('When would you like your demo?'), /\d\)/);
  assert.match(slotOfferText('Open times', [{ date: '2026-10-12', time: '15:00' }]), /1\) Mon 12 Oct, 3:00 PM/);
});

test('Other date is recognised from the button and from typed text', () => {
  for (const text of ['other-date', 'Other date', 'another day', 'different date', 'other']) assert.ok(isOtherDateChoice(text), text);
  for (const text of ['tomorrow', '12 oct', 'other times on monday please book']) assert.ok(!isOtherDateChoice(text), text);
});

test('a tap or typed reply picks only a listed slot', () => {
  const slots = [
    { date: '2026-10-12', time: '11:00' },
    { date: '2026-10-12', time: '15:00' },
    { date: '2026-10-12', time: '14:00' },
  ];
  assert.equal(pickOfferedSlotIndex('1', slots), 0, 'list row id');
  assert.equal(pickOfferedSlotIndex('3:00 PM', slots), 1, 'list row title');
  assert.equal(pickOfferedSlotIndex('2 pm', slots), 2, '"2 pm" is 2 PM, not row 2');
  assert.equal(pickOfferedSlotIndex('1 pm', slots), null, '1 PM was not offered');
  assert.equal(pickOfferedSlotIndex('12', slots), null);
  assert.equal(pickOfferedSlotIndex('other-date', slots), null);
});
