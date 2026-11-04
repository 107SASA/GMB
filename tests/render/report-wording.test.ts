/**
 * "Data required" wording: a category too broad to search for is never called
 * "generic" — and the connected profile's own category is the one shown
 * (Mulsetu said "Services" while its Google category was "Software company").
 * Run: npx tsx --test tests/render/report-wording.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/report-wording';
process.env.GROQ_API_KEY ||= 'report-wording';

const input = (over: any = {}) => ({
  category: 'Services', websiteSearchTerm: 'Website Development', gbpRead: false, gbpLive: null,
  ranking: { notRunReason: null }, fieldStates: {}, verifiedServices: [], keywordTable: [], websiteIntel: null, ...over,
});

test('connected report: the Google profile\'s own category, described accurately', async () => {
  const { buildDataRequired } = await import('../../src/services/ai/seoPlanEngine');
  const lines = buildDataRequired(input({ gbpRead: true, gbpLive: { primaryCategory: 'Software company' } }) as any, 'full');
  const line = lines.find((l: string) => /Website Development/.test(l))!;
  assert.equal(line, 'Your Google category ("Software company") is too broad to measure Maps rankings for, so we measured "Website Development" — a service your website names. Confirm it is your main service.');
  assert.ok(!lines.some((l: string) => /generic category/.test(l)));
});

test('free report (no Google connection): the public category', async () => {
  const { buildDataRequired } = await import('../../src/services/ai/seoPlanEngine');
  const lines = buildDataRequired(input() as any, 'free');
  assert.ok(lines.some((l: string) => l.startsWith('Your Google category ("Services") is too broad')));
});
