/**
 * Profile optimization → opening hours. Google replaces the whole hours
 * field on write, so a proposal for some days must carry the other days'
 * live hours unchanged, and a new special date must not wipe the others.
 *
 * Run: node --experimental-strip-types --test tests/integration/fr5-hours-merge.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRegularHours, mergeSpecialHours, toGoogleHours } from '../../src/services/gbp/changes/policy.ts';

const t = (hours: number, minutes = 0) => ({ hours, minutes });

const liveWeek = {
  periods: ['MONDAY', 'TUESDAY', 'WEDNESDAY'].map((day) => ({ openDay: day, closeDay: day, openTime: t(9), closeTime: t(18) })),
};

test('changing Monday keeps Tuesday and Wednesday as they are on Google', () => {
  const next = toGoogleHours({
    regular: [{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: '10:00', closeTime: '14:00' }],
    special: [],
  }).regularHours;
  const merged = mergeRegularHours(liveWeek, next) as { periods: any[] };
  assert.equal(merged.periods.length, 3);
  const monday = merged.periods.filter((p) => p.openDay === 'MONDAY');
  assert.equal(monday.length, 1);
  assert.deepEqual(monday[0].openTime, t(10));
  assert.ok(merged.periods.some((p) => p.openDay === 'TUESDAY' && p.openTime.hours === 9));
  assert.ok(merged.periods.some((p) => p.openDay === 'WEDNESDAY'));
});

test('an overnight live period on another day is kept untouched', () => {
  const live = { periods: [{ openDay: 'FRIDAY', closeDay: 'SATURDAY', openTime: t(20), closeTime: t(2) }] };
  const next = toGoogleHours({ regular: [{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: '09:00', closeTime: '17:00' }], special: [] }).regularHours;
  const merged = mergeRegularHours(live, next) as { periods: any[] };
  assert.equal(merged.periods.length, 2);
  assert.ok(merged.periods.some((p) => p.openDay === 'FRIDAY' && p.closeDay === 'SATURDAY'));
});

test('no live hours → only the proposed periods', () => {
  const next = toGoogleHours({ regular: [{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: '09:00', closeTime: '17:00' }], special: [] }).regularHours;
  assert.equal((mergeRegularHours(null, next) as { periods: any[] }).periods.length, 1);
});

test('a new special date keeps the other special dates; the same date is replaced, not duplicated', () => {
  const live = {
    specialHourPeriods: [
      { startDate: { year: 2026, month: 11, day: 8 }, closed: true },
      { startDate: { year: 2026, month: 12, day: 25 }, closed: true },
    ],
  };
  const next = toGoogleHours({
    regular: [],
    special: [{ startDate: '2026-12-25', closed: false, openTime: '10:00', closeTime: '13:00' }],
  }).specialHours;
  const merged = mergeSpecialHours(live, next) as { specialHourPeriods: any[] };
  assert.equal(merged.specialHourPeriods.length, 2);
  const christmas = merged.specialHourPeriods.filter((p) => p.startDate.month === 12 && p.startDate.day === 25);
  assert.equal(christmas.length, 1);
  assert.notEqual(christmas[0].closed, true);
  assert.ok(merged.specialHourPeriods.some((p) => p.startDate.month === 11 && p.startDate.day === 8));
});

test('a day ticked Closed loses its live hours; the other days are kept', () => {
  const merged = mergeRegularHours(liveWeek, { periods: [] }, ['WEDNESDAY']) as { periods: any[] };
  assert.equal(merged.periods.length, 2);
  assert.ok(!merged.periods.some((p) => p.openDay === 'WEDNESDAY'));
  assert.ok(merged.periods.some((p) => p.openDay === 'MONDAY'));
});
