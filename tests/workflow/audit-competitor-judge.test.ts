/**
 * S5 of the free report rebuild: the AI's same-trade verdict per competitor,
 * checked by code. No AI is called here.
 *
 * Run: npx tsx --test tests/workflow/audit-competitor-judge.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJudgements, sharesSpecificCategory, judgeHash, judgePrompt } from '../../src/services/audit/competitorJudge';

const target = {
  name: 'Inspiron Psychological Well-Being Centre', trade: 'mental health counselling and therapy',
  offerings: ['counselling', 'child psychology'], primaryCategory: 'Mental health service',
  additionalCategories: ['Psychologist'], servedHow: 'storefront', city: 'Bengaluru',
};
const cands = [
  { key: 'a', name: 'Mind Care', category: 'Psychologist', additionalCategories: [], snippet: null },
  { key: 'b', name: "Cloudnine Women's Clinic", category: "Women's health clinic", additionalCategories: [], snippet: null },
  { key: 'c', name: 'Calm Minds', category: 'Mental health service', additionalCategories: [], snippet: null },
  { key: 'd', name: 'DQ Labs Coaching', category: 'Coaching Center', additionalCategories: [], snippet: null },
];

test('each candidate gets the AI verdict; missing or bad entries are "unsure"', () => {
  const j = parseJudgements({ judgements: [
    { id: 1, verdict: 'yes', reason: 'psychologist' },
    { id: 2, verdict: 'no', reason: "women's clinic, different trade" },
    { id: 4, verdict: 'maybe', reason: '?' },
  ] }, target, cands);
  assert.equal(j.get('a')!.verdict, 'yes');
  assert.equal(j.get('b')!.verdict, 'no');
  assert.equal(j.get('c')!.verdict, 'unsure'); // not judged
  assert.equal(j.get('d')!.verdict, 'unsure'); // invalid verdict
});

test('the same specific Google category is never "no" — at worst "unsure"', () => {
  const j = parseJudgements({ judgements: [{ id: 3, verdict: 'no', reason: 'different' }] }, target, cands);
  assert.equal(j.get('c')!.verdict, 'unsure');
  assert.match(j.get('c')!.reason, /same Google category/);
});

test('a kind-only category ("Manufacturer") shared by both proves nothing', () => {
  assert.equal(sharesSpecificCategory({ primaryCategory: 'Manufacturer' }, { category: 'Manufacturer', additionalCategories: [] }), false);
  assert.equal(sharesSpecificCategory({ primaryCategory: 'Tiffin center' }, { category: 'Tiffin center', additionalCategories: [] }), true);
  assert.equal(sharesSpecificCategory({ primaryCategory: 'Tiffin center' }, { category: 'Restaurant', additionalCategories: ['Tiffin center'] }), true);
});

test('rubbish from the AI → every candidate "unsure", nothing shown', () => {
  const j = parseJudgements('not json', target, cands);
  assert.ok([...j.values()].every((v) => v.verdict === 'unsure'));
});

test('the saved result is tied to the target and the list', () => {
  assert.equal(judgeHash(target, cands), judgeHash(target, cands));
  assert.notEqual(judgeHash(target, cands), judgeHash(target, cands.slice(1)));
  assert.notEqual(judgeHash(target, cands), judgeHash({ ...target, trade: 'other' }, cands));
});

test('the prompt carries only Google fields and numbered ids', () => {
  const p = judgePrompt(target, cands);
  assert.match(p, /"id":\s?1/);
  assert.match(p, /Women's health clinic/);
  assert.match(p, /one entry for EVERY id/);
});

test('businesses ranked below keep their Google category, so they can be judged as "like yours nearby"', async () => {
  const { buildObservation } = await import('../../src/services/audit/facts');
  const o = buildObservation({
    keyword: 'led displays bengaluru', kind: 'discovery',
    results: [
      { position: 1, name: 'Zuper LED Bangalore', placeId: 'own', category: 'Manufacturer' },
      { position: 2, name: 'Brightview LED', placeId: 'p2', category: 'LED display supplier', rating: 4.6, reviewCount: 31, snippet: 'LED video walls' },
    ] as any,
    targetPosition: 1,
    isTarget: (r: any) => r.placeId === 'own',
  });
  assert.equal(o.ahead.length, 0);
  assert.equal(o.others?.[0].category, 'LED display supplier');
  assert.equal(o.others?.[0].reviewCount, 31);
  assert.equal(o.others?.[0].snippet, 'LED video walls');
});
