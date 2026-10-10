/**
 * Profile optimization page: customer-facing formatting of proposals. Pure.
 * Run: node --experimental-strip-types --test tests/integration/profile-optimization-presentation.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTS_TEXT,
  actionResultText,
  attributeLabel,
  businessTypeText,
  formatValue,
  groupDuplicates,
  kindLabel,
  lineChanges,
  pinText,
  shortReference,
  statusInfo,
  usesWordDiff,
} from '../../src/app/dashboard/profile-optimization/presentation.ts';

const NO_RAW = /[{}"]|attributes\/|categories\/|gcid:|valueType|TimeOfDay|_ENABLED/;

test('attribute proposals read as a label and a value, not Google JSON', () => {
  const proposed = { name: 'attributes/has_wheelchair_accessible_entrance', attribute: { name: 'attributes/has_wheelchair_accessible_entrance', valueType: 'BOOL', values: [true] } };
  assert.equal(formatValue('attribute', proposed), 'Wheelchair accessible entrance: Yes');
  assert.equal(formatValue('attribute', proposed, { 'attributes/has_wheelchair_accessible_entrance': 'Wheelchair-accessible entrance' }), 'Wheelchair-accessible entrance: Yes');
  assert.equal(formatValue('attribute', null), 'Not set');
  const url = { name: 'attributes/url_appointment', attribute: { name: 'attributes/url_appointment', valueType: 'URL', uriValues: [{ uri: 'https://example.com/book' }] } };
  assert.equal(formatValue('attribute', url), 'Appointment link: https://example.com/book');
  assert.equal(attributeLabel('attributes/url_menu'), 'Menu link');
});

test('hours read as days and times', () => {
  const value = {
    regularHours: { periods: [
      { openDay: 'TUESDAY', closeDay: 'TUESDAY', openTime: { hours: 9 }, closeTime: { hours: 18, minutes: 30 } },
      { openDay: 'MONDAY', closeDay: 'MONDAY', openTime: { hours: 9, minutes: 0 }, closeTime: { hours: 18 } },
    ] },
    specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 11, day: 8 }, endDate: { year: 2026, month: 11, day: 8 }, closed: true }] },
  };
  const text = formatValue('hours', value);
  assert.equal(text, 'Monday: 09:00–18:00\nTuesday: 09:00–18:30\nSpecial hours 2026-11-08: Closed');
  assert.doesNotMatch(text, NO_RAW);
});

test('categories, services and service areas read as names', () => {
  const cats = formatValue('primary_category', { primaryCategory: { name: 'categories/gcid:tile_contractor' }, additionalCategories: [{ name: 'categories/gcid:flooring_store', displayName: 'Flooring store' }] });
  assert.equal(cats, 'Primary: Tile contractor\nAdditional: Flooring store');
  const services = formatValue('services', [{ freeFormServiceItem: { category: 'categories/gcid:x', label: { displayName: 'Bathroom tiling' } } }, { structuredServiceItem: { serviceTypeId: 'job_type_id:floor_installation' } }]);
  assert.equal(services, '• Bathroom tiling\n• Floor installation');
  const area = formatValue('service_area', { businessType: 'CUSTOMER_LOCATION_ONLY', regionCode: 'IN', places: { placeInfos: [{ placeId: 'ChIJ1', placeName: 'Nashik' }] } });
  assert.equal(area, '• Nashik');
  for (const text of [cats, services, area]) assert.doesNotMatch(text, NO_RAW);
});

test('unknown shapes fall back to readable lines, never braces', () => {
  const text = formatValue('mystery', { a: 1, b: { c: 'x' } });
  assert.equal(text, 'a: 1\nb › c: x');
  assert.equal(formatValue('description', 'Plain text'), 'Plain text');
});

test('identical proposals collapse to the newest record, others are counted', () => {
  const rows = [
    { _id: 'c3', kind: 'description', status: 'PROPOSED', proposed: 'A' },
    { _id: 'c2', kind: 'description', status: 'PROPOSED', proposed: 'A' },
    { _id: 'c1', kind: 'description', status: 'BLOCKED', proposed: 'A' },
    { _id: 'c0', kind: 'description', status: 'PROPOSED', proposed: 'B' },
  ];
  const groups = groupDuplicates(rows);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].change._id, 'c3');
  assert.deepEqual(groups[0].duplicates.map((d) => d._id), ['c2']);
  assert.equal(rows.length, 4);
});

test('labels and status text use plain language', () => {
  assert.equal(kindLabel('primary_category'), 'Primary category');
  assert.equal(kindLabel('service_area'), 'Service area');
  assert.equal(statusInfo('PROPOSED').group, 'waiting');
  assert.equal(statusInfo('APPROVED').group, 'approved');
  assert.equal(statusInfo('VERIFIED').group, 'live');
  assert.equal(statusInfo('BLOCKED').label, 'Not applied');
  assert.equal(statusInfo('BLOCKED').group, 'closed');
  assert.equal(shortReference('66f0c0ffee0123456789abcd'), '#89abcd');
  assert.doesNotMatch(pinText('UNKNOWN'), /UNKNOWN|\?address/);
  assert.doesNotMatch(businessTypeText('CUSTOMER_AND_BUSINESS_LOCATION'), /_/);
  assert.doesNotMatch(PRODUCTS_TEXT, /v1|v4|resource/);
});

test('structured values compare by line, so times are never spliced together', () => {
  assert.equal(usesWordDiff('description'), true);
  assert.equal(usesWordDiff('hours'), false);
  assert.equal(usesWordDiff('attribute'), false);
  const lines = lineChanges('Monday: 10:00–18:00\nTuesday: 09:00–18:00', 'Monday: 09:00–19:30\nTuesday: 09:00–18:00');
  assert.deepEqual(lines.after, [{ text: 'Monday: 09:00–19:30', changed: true }, { text: 'Tuesday: 09:00–18:00', changed: false }]);
  assert.deepEqual(lines.before, [{ text: 'Monday: 10:00–18:00', changed: true }, { text: 'Tuesday: 09:00–18:00', changed: false }]);
});

test('action results explain what happened on Google', () => {
  assert.match(actionResultText('approve', { success: true }), /Nothing has been sent to Google/);
  assert.match(actionResultText('execute', { success: false, error: 'Live Google writes are disabled.' }), /switched off.*nothing was sent.*still approved/);
  assert.doesNotMatch(actionResultText('execute', { success: false, error: 'Live Google writes are disabled.' }), /Not applied/);
  assert.match(actionResultText('rollback', { success: false, error: 'Live Google writes are disabled.' }), /still live/);
  assert.doesNotMatch(actionResultText('execute', { success: false, error: 'Live Google writes are disabled.' }), /_ENABLED/);
  assert.match(actionResultText('execute', { success: true, liveWriteApplied: true }), /confirmed/);
  assert.match(actionResultText('rollback', { success: true }), /Rolled back/);
  assert.doesNotMatch(actionResultText('execute', { success: true }), /execute completed/);
});
