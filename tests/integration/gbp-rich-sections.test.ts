/**
 * Menu, hotel details and booking buttons — pure rules. No Google calls.
 * Run: node --experimental-strip-types --test tests/integration/gbp-rich-sections.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFoodMenuWrite, buildLodgingWrite, canonicalFoodMenus, canonicalLodging, flattenLodging,
  foodMenusToDraft, mergeMenuDrafts, nestLodging, sanitizeMenuDraft, suggestLodgingFromText, validatePlaceAction,
} from '../../src/services/gbp/changes/richSections.ts';
import { canonicalFingerprint, classifyReadBack } from '../../src/services/gbp/changes/policy.ts';

test('menu: AI read is cleaned, prices parsed, duplicates and junk dropped', () => {
  const d = sanitizeMenuDraft({
    currency: 'xx',
    sections: [
      { name: 'Starters', items: [{ name: 'Paneer Tikka', price: '₹240', veg: true, spice: 'medium' }, { name: 'paneer tikka', price: 1 }, { name: '', price: 5 }] },
      { name: 'Empty', items: [] },
      { name: 'starters', items: [{ name: 'Chicken 65', price: 280.5, veg: false, spice: 'nuclear' }] },
    ],
  });
  assert.equal(d.currency, 'INR');
  assert.equal(d.sections.length, 1, 'same-named sections merged, empty dropped');
  assert.deepEqual(d.sections[0].items.map((i) => [i.name, i.price, i.veg, i.spice]), [
    ['Paneer Tikka', 240, true, 'MEDIUM'],
    ['Chicken 65', 280.5, false, null],
  ]);
});

test('menu: Google needs a price on every dish; the write keeps Google-only extras of existing dishes', () => {
  const missing = buildFoodMenuWrite({ sections: [{ name: 'Mains', items: [{ name: 'Dal Makhani', price: null }] }] });
  assert.equal(missing.valid, false);
  assert.match(missing.violations[0].message, /Dal Makhani/);

  const existing = { menus: [{ labels: [{ displayName: 'Dinner' }], cuisines: ['INDIAN'], sections: [{ labels: [{ displayName: 'Mains' }], items: [
    { labels: [{ displayName: 'Dal Makhani' }], options: [{ labels: [{ displayName: 'Full' }], attributes: { price: { currencyCode: 'INR', units: '300' } } }],
      attributes: { price: { currencyCode: 'INR', units: '180' }, mediaKeys: ['photo1'], allergen: ['DAIRY'] } },
  ] }] }] };
  const w = buildFoodMenuWrite({ currency: 'INR', sections: [{ name: 'Mains', items: [{ name: 'Dal Makhani', price: 199.5, veg: true }, { name: 'Jeera Rice', price: 120 }] }] }, { existing });
  assert.equal(w.valid, true);
  const menu: any = (w.foodMenus as any).menus[0];
  assert.equal(menu.labels[0].displayName, 'Dinner');
  assert.deepEqual(menu.cuisines, ['INDIAN']);
  const dal = menu.sections[0].items[0];
  assert.deepEqual(dal.attributes.price, { currencyCode: 'INR', units: '199', nanos: 500000000 });
  assert.deepEqual(dal.attributes.mediaKeys, ['photo1'], 'photo kept');
  assert.deepEqual(dal.attributes.allergen, ['DAIRY'], 'allergen kept');
  assert.deepEqual(dal.attributes.dietaryRestriction, ['VEGETARIAN']);
  assert.equal(dal.options.length, 1, 'size options kept');
  assert.equal(menu.sections[0].items[1].attributes.mediaKeys, undefined);
});

test('menu: new photo read is merged into the current menu without dropping anything', () => {
  const current = { currency: 'INR', sections: [{ name: 'Mains', items: [{ name: 'Dal Makhani', price: 180 }, { name: 'Naan', price: null }] }] };
  const scanned = { currency: 'INR', sections: [
    { name: 'Mains', items: [{ name: 'Dal makhani', price: 999 }, { name: 'Shahi Paneer', price: 260 }] },
    { name: 'Breads', items: [{ name: 'Naan', price: 40 }, { name: 'Roti', price: 20 }] },
  ] };
  const m = mergeMenuDrafts(current, scanned);
  const all = m.sections.flatMap((s) => s.items.map((i) => `${s.name}:${i.name}:${i.price}`));
  assert.deepEqual(all, ['Mains:Dal Makhani:180', 'Mains:Naan:40', 'Mains:Shahi Paneer:260', 'Breads:Roti:20']);
});

test('menu: read-back compares names and prices, not Google’s extra fields', () => {
  const w = buildFoodMenuWrite({ sections: [{ name: 'Mains', items: [{ name: 'Dal', price: 180, veg: true }] }] });
  const proposed = w.foodMenus;
  const google = { name: 'accounts/1/locations/2/foodMenus', menus: [{ labels: [{ displayName: 'Menu', languageCode: 'en' }], sections: [{ labels: [{ displayName: 'Mains', languageCode: 'en' }], items: [{ labels: [{ displayName: 'Dal', languageCode: 'en' }], attributes: { price: { currencyCode: 'INR', units: '180', nanos: 0 }, dietaryRestriction: ['VEGETARIAN'] } }] }] }] };
  assert.equal(canonicalFingerprint('food_menu', proposed), canonicalFingerprint('food_menu', google));
  assert.equal(classifyReadBack('food_menu', { menus: [] }, proposed, google), 'VERIFIED');
  assert.equal(canonicalFoodMenus({ menus: [] }), null);
  assert.equal(foodMenusToDraft(google)?.sections[0].items[0].veg, true);
});

test('hotel details: only known fields, only real changes, times validated; nested for Google', () => {
  const current = { 'pools.pool': false, 'policies.checkinTime': '12:00', 'connectivity.freeWifi': null } as any;
  const w = buildLodgingWrite({ 'pools.pool': true, 'policies.checkinTime': '12:00', 'connectivity.freeWifi': true }, current);
  assert.equal(w.valid, true);
  assert.deepEqual(w.fields, { 'pools.pool': true, 'connectivity.freeWifi': true }, 'unchanged check-in left out');
  assert.equal(buildLodgingWrite({ 'policies.checkinTime': '25:00' }, {}).valid, false);
  assert.equal(buildLodgingWrite({ 'made.up': true }, {}).valid, false);
  assert.equal(buildLodgingWrite({ 'pools.pool': false }, { 'pools.pool': false }).valid, false, 'nothing changed');
  assert.deepEqual(nestLodging({ 'pools.pool': true, 'policies.checkoutTime': '11:30', 'wellness.spa': null }), {
    pools: { pool: true }, policies: { checkoutTime: { hours: 11, minutes: 30 } },
  });
  const read = flattenLodging({ pools: { pool: true }, policies: { checkoutTime: { hours: 11, minutes: 30 } } }, ['pools.pool', 'policies.checkoutTime', 'wellness.spa']);
  assert.deepEqual(read, { 'pools.pool': true, 'policies.checkoutTime': '11:30', 'wellness.spa': null });
  assert.deepEqual(canonicalLodging({ 'policies.checkoutTime': { hours: 11, minutes: 30 } }), canonicalLodging({ 'policies.checkoutTime': '11:30' }));
});

test('hotel details: amenities their own text mentions are pre-ticked (never ones already set)', () => {
  const s = suggestLodgingFromText('Rooftop swimming pool, complimentary breakfast, free Wi-Fi and 24x7 front desk', { 'connectivity.freeWifi': true } as any);
  assert.ok(s.includes('pools.pool'));
  assert.ok(s.includes('foodAndDrink.freeBreakfast'));
  assert.ok(s.includes('services.twentyFourHourFrontDesk'));
  assert.ok(!s.includes('connectivity.freeWifi'), 'already set on Google');
  assert.ok(!s.includes('wellness.spa'));
});

test('booking buttons: only types Google offers here, real https pages only', () => {
  assert.equal(validatePlaceAction({ placeActionType: 'APPOINTMENT', uri: 'https://example.com/book' }, ['APPOINTMENT']).valid, true);
  assert.equal(validatePlaceAction({ placeActionType: 'FOOD_ORDERING', uri: 'https://example.com' }, ['APPOINTMENT']).valid, false);
  assert.equal(validatePlaceAction({ placeActionType: 'APPOINTMENT', uri: 'http://example.com' }, null).valid, false);
  assert.equal(validatePlaceAction({ placeActionType: 'APPOINTMENT', uri: 'https://wa.me/9198' }, null).valid, false);
  assert.equal(validatePlaceAction({ placeActionType: 'NOPE', uri: 'https://x.com' }, null).valid, false);
  assert.deepEqual(validatePlaceAction({ placeActionType: 'SHOP_ONLINE', uri: null }, null).value, { placeActionType: 'SHOP_ONLINE', uri: null });
  assert.equal(classifyReadBack('place_action', { placeActionType: 'APPOINTMENT', uri: null }, { placeActionType: 'APPOINTMENT', uri: 'https://x.com/book/' }, { placeActionType: 'APPOINTMENT', uri: 'https://x.com/book' }), 'VERIFIED');
});
