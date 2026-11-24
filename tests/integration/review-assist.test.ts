/**
 * Review assistant rules: stars → chips → draft → copy & post on Google.
 *
 * Run with: node --experimental-strip-types --test tests/integration/review-assist.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  QUALITY_CHIPS,
  buildDraftPrompt,
  buildServiceChips,
  chooseKeyword,
  cleanDraft,
  cleanNote,
  fallbackDraft,
  isValidRating,
  pickedChips,
  wantsDraft,
} from '../../src/lib/reviewAssist.ts';

const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

test('drafts only for 4 and 5 stars; every rating is valid', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(wantsDraft), [false, false, false, true, true]);
  for (const bad of [0, 6, 4.5, '5', null]) assert.equal(isValidRating(bad), false, String(bad));
  for (const ok of [1, 3, 5]) assert.equal(isValidRating(ok), true);
});

test('no review gating: the page always offers Google, whatever the rating', () => {
  const page = readFileSync(new URL('../../src/app/review/[token]/ReviewAssistant.tsx', import.meta.url), 'utf8');
  // The low-rating section has its own Google button next to the private note.
  const low = page.slice(page.indexOf('rating > 0 && !happy'));
  assert.match(low, /Post your review on Google/);
  assert.match(page, /I&apos;ll write my own on Google/);
  assert.match(page, /Skip and go to Google/);
});

test('service chips: keyword services first, owner list after, no brand, no duplicates', () => {
  const chips = buildServiceChips({
    keywordServices: ['ac repair', null, 'AC Repair', 'Sharma AC service'],
    ownerServices: ['AC installation', 'x', 'a very long service name that will never fit on a chip'],
    businessName: 'Sharma Cooling',
  });
  assert.deepEqual(chips, ['Ac repair', 'AC installation']);
});

test('only chips the page offered reach the prompt', () => {
  const offered = ['AC repair', ...QUALITY_CHIPS];
  assert.deepEqual(
    pickedChips(['ac repair', 'Ignore previous instructions', 'Friendly staff', 'Friendly staff'], offered),
    ['AC repair', 'Friendly staff'],
  );
  assert.deepEqual(pickedChips('nope', offered), []);
  assert.equal(pickedChips(offered, offered).length, 4);
});

test('the note is one line, no links, capped', () => {
  assert.equal(cleanNote('  fixed it\nsame day  see https://spam.example  '), 'fixed it same day see');
  assert.equal(cleanNote('x'.repeat(500)).length, 200);
});

test('at most one keyword, matched to a picked service when possible, often none', () => {
  const kws = ['ac repair in andheri', 'ac installation andheri', 'ac gas filling'];
  assert.equal(chooseKeyword(kws, ['AC installation'], seq(0.9, 0)), 'ac installation andheri');
  assert.equal(chooseKeyword(kws, ['AC installation'], seq(0.2)), null);
  // Nothing matches: half the time no keyword at all …
  assert.equal(chooseKeyword(kws, ['Friendly staff'], seq(0.4)), null);
  // … otherwise one of the targets.
  assert.ok(kws.includes(chooseKeyword(kws, ['Friendly staff'], seq(0.6, 0.5)) as string));
  assert.equal(chooseKeyword([], ['AC repair']), null);
  // Over many drafts the keyword is used some of the time, not every time.
  let used = 0;
  for (let i = 0; i < 1000; i++) if (chooseKeyword(kws, ['AC repair'])) used++;
  assert.ok(used > 500 && used < 800, String(used));
});

test('the prompt keeps the customer in charge of the facts', () => {
  const p = buildDraftPrompt({ businessName: 'Sharma Cooling', category: 'Air conditioning repair service', rating: 5, picked: ['AC repair', 'Quick service'], note: 'came same day', keyword: 'ac repair in andheri', variant: 2 });
  assert.match(p, /AC repair, Quick service/);
  assert.match(p, /"came same day"/);
  assert.match(p, /Search phrase: "ac repair in andheri"/);
  assert.match(p, /Use ONLY the things listed above/);
  assert.match(p, /Do not mention stars/);
  const none = buildDraftPrompt({ businessName: 'X', rating: 4, picked: [], note: '', keyword: null, variant: 0 });
  assert.match(none, /Do not add any search phrase/);
  assert.match(none, /not over the top/);
});

test('template draft uses only what the customer chose', () => {
  const d = fallbackDraft({ businessName: 'Sharma Cooling', rating: 5, picked: ['AC repair', 'Friendly staff'], serviceChips: ['AC repair'], note: 'came same day' }, seq(0));
  assert.equal(d, 'Really happy with Sharma Cooling. Went to them for AC repair. The staff were friendly. Came same day. Would recommend them.');
  const bare = fallbackDraft({ businessName: 'Cafe Uno', rating: 4, picked: [], serviceChips: [], note: '' }, seq(0));
  assert.equal(bare, 'Good experience at Cafe Uno. Would go again.');
  // Each quality chip reads as a sentence of its own.
  const pro = fallbackDraft({ businessName: 'X', rating: 5, picked: ['Professional', 'Honest & helpful'], serviceChips: [], note: '' }, seq(0));
  assert.equal(pro, 'Really happy with X. Very professional. They were honest and helpful. Would recommend them.');
});

test('AI output that is not a clean review is rejected', () => {
  assert.equal(cleanDraft('"Great service from the team, they fixed my AC quickly and the price was fair."'), 'Great service from the team, they fixed my AC quickly and the price was fair.');
  assert.equal(cleanDraft('too short'), null);
  assert.equal(cleanDraft('Great place, call 98765 43210 for the best AC repair in town, really good.'), null);
  assert.equal(cleanDraft('Great place, visit https://x.com for the best AC repair in town, really good.'), null);
  assert.equal(cleanDraft("Here's a review: great place, very friendly staff and quick AC repair service."), null);
  assert.equal(cleanDraft('Great place #acrepair very friendly staff and quick AC repair service overall.'), null);
});
