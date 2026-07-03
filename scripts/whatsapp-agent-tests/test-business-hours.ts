/**
 * Pure-logic tests for src/services/whatsapp-agent/businessHours.ts and
 * dateTimeUtils.ts. No DB / network required — run with:
 *   npx tsx scripts/whatsapp-agent-tests/test-business-hours.ts
 *
 * Mirrors the spec's own worked examples:
 *   VALID:   Monday 3 PM when business hours are 9 AM-6 PM.
 *   INVALID: Sunday if disabled.
 *   INVALID: Yesterday.
 *   INVALID: Today at 8 AM when current time is 10 AM. (i.e. a past time today)
 *   INVALID: 8 PM if closing time is 6 PM.
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_WORKING_HOURS,
  resolveWorkingHoursConfig,
  suggestAlternativeSlots,
  validateSlot,
} from '../../src/services/whatsapp-agent/businessHours';
import { dayKeyOfDateString, getBusinessNow, isValidDateString, isValidTimeString, zonedTimeToUtc } from '../../src/services/whatsapp-agent/dateTimeUtils';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e: any) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${e.message}`);
  }
}

const TZ = 'Asia/Kolkata';
const now = getBusinessNow(TZ);
const todayStr = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;

function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

const yesterdayStr = addDaysStr(todayStr, -1);

// Find the next Monday from today (inclusive) so the "valid" test is stable
// regardless of what day the suite happens to run on.
function nextDayOfWeek(from: string, target: 'monday'): string {
  let cursor = from;
  for (let i = 0; i < 8; i++) {
    if (dayKeyOfDateString(cursor) === target) return cursor;
    cursor = addDaysStr(cursor, 1);
  }
  throw new Error('unreachable');
}
const nextMonday = nextDayOfWeek(addDaysStr(todayStr, 1), 'monday'); // strictly future Monday

const standardConfig = {
  ...DEFAULT_WORKING_HOURS,
  bookingEnabled: true,
  timezone: TZ,
  openingTime: '09:00',
  closingTime: '18:00',
};

console.log('\n=== businessHours.validateSlot ===');

test('VALID: a future Monday 3 PM when hours are 9 AM-6 PM', () => {
  const result = validateSlot(standardConfig, nextMonday, '15:00');
  assert.equal(result.valid, true, JSON.stringify(result));
});

test('INVALID: a disabled day is rejected regardless of time', () => {
  const cfg = { ...standardConfig, workingDays: { ...standardConfig.workingDays, sunday: false } };
  let cursor = addDaysStr(todayStr, 1);
  for (let i = 0; i < 8; i++) {
    if (dayKeyOfDateString(cursor) === 'sunday') break;
    cursor = addDaysStr(cursor, 1);
  }
  const result = validateSlot(cfg, cursor, '15:00');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'closed_day');
});

test('INVALID: yesterday is always rejected', () => {
  const result = validateSlot(standardConfig, yesterdayStr, '15:00');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'past_date');
});

test('INVALID: a time today that has already passed', () => {
  // 1 minute before "now" in business tz — guaranteed to be in the past,
  // and guaranteed to fall on today's working-day/hours status being
  // irrelevant to the assertion (we only assert past_time OR closed_day/
  // outside_hours never fires first in the common case of a working day
  // within hours). To keep this deterministic we force workingDays/hours
  // wide open and only assert the specific past_time path when today's
  // clock time is itself within business hours.
  const wideOpenConfig = {
    ...standardConfig,
    workingDays: {
      monday: true, tuesday: true, wednesday: true, thursday: true,
      friday: true, saturday: true, sunday: true,
    },
    openingTime: '00:00',
    closingTime: '23:59',
  };
  const nowMinutes = now.hour * 60 + now.minute;
  if (nowMinutes < 2) {
    console.log('    (skipped — test running too close to midnight IST for a stable past-time check)');
    return;
  }
  const pastMinutes = nowMinutes - 1;
  const pastTime = `${String(Math.floor(pastMinutes / 60)).padStart(2, '0')}:${String(pastMinutes % 60).padStart(2, '0')}`;
  const result = validateSlot(wideOpenConfig, todayStr, pastTime);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'past_time');
});

test('INVALID: 8 PM when closing time is 6 PM', () => {
  const result = validateSlot(standardConfig, nextMonday, '20:00');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'outside_hours');
});

test('INVALID: booking disabled short-circuits everything else', () => {
  const cfg = { ...standardConfig, bookingEnabled: false };
  const result = validateSlot(cfg, nextMonday, '15:00');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'booking_disabled');
});

test('resolveWorkingHoursConfig defaults bookingEnabled=false when business has no settings at all', () => {
  const cfg = resolveWorkingHoursConfig(undefined);
  assert.equal(cfg.bookingEnabled, false);
});

test('resolveWorkingHoursConfig merges partial overrides over defaults', () => {
  const cfg = resolveWorkingHoursConfig({ bookingEnabled: true, openingTime: '10:00' });
  assert.equal(cfg.bookingEnabled, true);
  assert.equal(cfg.openingTime, '10:00');
  assert.equal(cfg.closingTime, DEFAULT_WORKING_HOURS.closingTime);
});

console.log('\n=== businessHours.suggestAlternativeSlots ===');

test('suggests slots that are all within business hours and not excluded', () => {
  const slots = suggestAlternativeSlots(standardConfig, nextMonday, ['09:00', '09:30'], 3);
  assert.equal(slots.length, 3);
  for (const s of slots) {
    assert.notEqual(s.time, '09:00');
    assert.notEqual(s.time, '09:30');
  }
});

test('falls forward to the next working day if requested day has no room left', () => {
  const cfg = { ...standardConfig, openingTime: '09:00', closingTime: '09:30', slotDurationMinutes: 30 };
  // Only one slot (09:00) exists on nextMonday and it's excluded, so it must roll to Tuesday.
  const slots = suggestAlternativeSlots(cfg, nextMonday, ['09:00'], 1);
  assert.equal(slots.length, 1);
  assert.notEqual(slots[0].date, nextMonday);
});

console.log('\n=== dateTimeUtils ===');

test('dayKeyOfDateString is timezone-independent and correct', () => {
  assert.equal(dayKeyOfDateString('2026-07-06'), 'monday'); // known Monday
  assert.equal(dayKeyOfDateString('2026-07-05'), 'sunday');
});

test('isValidDateString rejects malformed/impossible dates', () => {
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(isValidDateString('2026-13-01'), false);
  assert.equal(isValidDateString('2026-07-02'), true);
});

test('isValidTimeString enforces 24hr HH:mm', () => {
  assert.equal(isValidTimeString('9:00'), false);
  assert.equal(isValidTimeString('24:00'), false);
  assert.equal(isValidTimeString('09:00'), true);
  assert.equal(isValidTimeString('23:59'), true);
});

test('zonedTimeToUtc round-trips correctly for a fixed-offset zone (Asia/Kolkata, UTC+5:30)', () => {
  const utc = zonedTimeToUtc('2026-07-06', '15:00', 'Asia/Kolkata');
  // 15:00 IST == 09:30 UTC
  assert.equal(utc.getUTCHours(), 9);
  assert.equal(utc.getUTCMinutes(), 30);
});

test('zonedTimeToUtc handles a DST-observing zone (America/New_York) correctly', () => {
  // July is EDT (UTC-4)
  const utc = zonedTimeToUtc('2026-07-06', '15:00', 'America/New_York');
  assert.equal(utc.getUTCHours(), 19);
  assert.equal(utc.getUTCMinutes(), 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
