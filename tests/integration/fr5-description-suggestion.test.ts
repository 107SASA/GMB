/**
 * Which business description is offered, and how proposals made for a
 * previously connected Google listing are recognised. Pure policy, no I/O.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseDescriptionSuggestion,
  draftDescription,
  isWeakDescription,
  proposalsForOtherListing,
} from '../../src/services/gbp/changes/policy.ts';

const tokens = ['Bakery and Cake Shop', 'Kolkata', 'Bakery'];
const template = draftDescription({ name: "Michelle's Foods", category: 'Bakery and Cake Shop', city: 'Kolkata', services: [] });
const rich = "Michelle's Foods is a home bakery in Patuli, Kolkata, serving Patuli, Garia, Kalikapur, Mukundapur, Santoshpur, Golf Green and Baghajatin. "
  + 'We make freshly baked homemade cakes, custom birthday cakes, cupcakes, brownies, tea cakes, pastries and savoury tarts in small batches using quality ingredients. '
  + 'We also offer festive hampers and dessert boxes, with delivery across South Kolkata.';

test('a long description that leads with the category or city is not replaced', () => {
  assert.equal(isWeakDescription(rich, tokens), false);
  const s = chooseDescriptionSuggestion({ current: rich, planDescription: null, template, tokens });
  assert.equal(s.text, null);
  assert.equal(s.reason, 'current_is_good');
  // Not even by the AI draft.
  const withPlan = chooseDescriptionSuggestion({ current: rich, planDescription: `${template} Fresh cakes daily.`, template, tokens });
  assert.equal(withPlan.text, null);
});

test('missing, short, or off-topic descriptions are weak', () => {
  assert.equal(isWeakDescription('', tokens), true);
  assert.equal(isWeakDescription(null, tokens), true);
  assert.equal(isWeakDescription('Cakes.', tokens), true);
  assert.equal(isWeakDescription('x '.repeat(200), tokens), true);
});

test('the SEO plan draft is preferred over the template', () => {
  const plan = "Michelle's Foods is a home bakery in Kolkata making custom birthday cakes, cupcakes, brownies and tea cakes in small batches, with delivery across South Kolkata.";
  const s = chooseDescriptionSuggestion({ current: '', planDescription: plan, template, tokens });
  assert.equal(s.origin, 'seo_plan');
  assert.equal(s.text, plan);
});

test('a plan draft with an unverified-fact marker or failing the rules falls back to the template', () => {
  const marked = chooseDescriptionSuggestion({ current: '', planDescription: "Michelle's Foods is a bakery in Kolkata since [confirm: year founded].", template, tokens });
  assert.equal(marked.origin, 'template');
  const promo = chooseDescriptionSuggestion({ current: '', planDescription: "Michelle's Foods is the best bakery in Kolkata.", template, tokens });
  assert.equal(promo.origin, 'template');
  assert.equal(promo.text, template);
});

test('the template never replaces a weak description that is longer than it', () => {
  const longish = 'We bake cakes to order for birthdays, weddings and office parties, and deliver them the same day across the south of the city. Call to place an order.';
  assert.ok(longish.length > template.length);
  const s = chooseDescriptionSuggestion({ current: longish, planDescription: null, template, tokens });
  assert.equal(s.text, null);
  assert.equal(s.reason, 'nothing_better');
});

test('proposals made for another listing are found; the account prefix does not matter', () => {
  const rows = [
    { _id: 'a', locationId: 'locations/3092955366259084685' },
    { _id: 'b', locationId: 'accounts/9/locations/15734413344546142094' },
    { _id: 'c', locationId: '' },
  ];
  assert.deepEqual(proposalsForOtherListing(rows, 'locations/15734413344546142094'), ['a', 'c']);
  // No listing connected: nothing is closed (reconnecting the same one fixes them).
  assert.deepEqual(proposalsForOtherListing(rows, null), []);
  assert.deepEqual(proposalsForOtherListing(rows, ''), []);
});
