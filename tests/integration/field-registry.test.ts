/**
 * The customer-visible field registry (src/services/audit/fieldRegistry.ts)
 * checked against the REAL display helpers: when data is unknown,
 * unavailable or not measured, every surface shows a status — never a
 * number. Run: node --experimental-strip-types --test tests/integration/field-registry.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_REGISTRY } from '../../src/services/audit/fieldRegistry.ts';
import {
  completionBreakdown,
  completionSentence,
  competitorTierLabel,
  rankLabel,
  rankingStatRows,
  reviewDisplay,
  suspensionDisplay,
  toRankValue,
} from '../../src/services/audit/reportDisplay.ts';
import { leadMessageFacts, resolveRankHeadline } from '../../src/services/audit/reportMath.ts';

const rule = (field: string) => {
  const r = FIELD_REGISTRY.find((x) => x.field === field);
  assert.ok(r, `registry row "${field}"`);
  return r!;
};

test('registry: every row is complete, and no missing-data text contains a number', () => {
  for (const r of FIELD_REGISTRY) {
    for (const k of ['field', 'source', 'collection', 'reads', 'evidenceState', 'display', 'whenMissing', 'forbiddenFallback'] as const) {
      assert.ok(String(r[k] || '').trim(), `${r.field}.${k}`);
    }
    assert.ok(r.surfaces.length > 0, r.field);
    assert.ok(!/\d/.test(r.whenMissing), `${r.field}: missing-data text must not contain a number`);
  }
});

test('registry ↔ ranking display: unavailable, not found, no measurement', () => {
  const headline = resolveRankHeadline({ facts: { ranking: { overall: { status: 'unavailable', testedCount: 0, totalSearches: 11 } } } });
  assert.equal(headline.display, rule('Average rank where found').whenMissing);
  assert.equal(headline.value, null);
  assert.equal(rankLabel(toRankValue({ found: false, status: 'ok' })), 'Not found');
  assert.equal(rankLabel(toRankValue({ found: false, status: 'unavailable' })), 'Unavailable');
  assert.ok(rule('Rank for one search').whenMissing.includes('Not found') && rule('Rank for one search').whenMissing.includes('Unavailable'));
  assert.deepEqual(rankingStatRows(null), [{ label: 'Searches measured', value: rule('Visibility / Top 3 / Top 5 / Top 10').whenMissing }]);
  const unavailableRows = rankingStatRows({ status: 'unavailable', totalSearches: 11 } as any);
  assert.ok(!unavailableRows.some((r) => /%|#/.test(r.value)), 'no rates or ranks from a failed check');
});

test('registry ↔ review display: lifetime, recent, reply state, themes', () => {
  const unknown = reviewDisplay({ lifetime: { status: 'unknown' }, recent: { status: 'unknown', periodDays: 14 } }, 'unknown');
  assert.equal(unknown.lifetimeCount, rule('Lifetime Google reviews + rating').whenMissing);
  assert.equal(unknown.lifetimeRating, 'Unknown');
  assert.equal(unknown.recentCount, 'Not measured');
  assert.equal(unknown.reviewsPerWeek, 'Unknown');
  assert.ok(rule('Recent reviews / reviews per week').whenMissing.includes('Not measured'));
  assert.equal(unknown.themes, rule('Review themes (praise / complaints)').whenMissing);
  const replyUnknown = reviewDisplay({ lifetime: { status: 'verified', totalCount: 9 }, recent: { status: 'verified', periodDays: 14, newReviewCount: 2, responseRate: null, replyUnknownCount: 1 } });
  assert.equal(replyUnknown.responseRate, 'Unknown — reply status not yet re-synced');
  assert.ok(rule('Review response rate').whenMissing.includes(replyUnknown.responseRate));
});

test('registry ↔ profile, suspension, competitor tiers', () => {
  const allUnknown = completionBreakdown([{ status: 'Unknown' }, { status: 'Unknown' }]);
  assert.equal(allUnknown.pct, null, 'no percentage from zero checked fields');
  assert.equal(completionSentence(allUnknown), rule('Profile completion %').whenMissing);
  assert.equal(suspensionDisplay(null).level, rule('Suspension risk').whenMissing);
  assert.equal(competitorTierLabel({ relevance: 'unmeasured' }, 0), 'Nearby business — not from ranking results');
  assert.equal(competitorTierLabel({ relevance: 'incidental', searchesAhead: 1, appearances: 1 }, 11), 'Seen above you once');
  assert.equal(competitorTierLabel({ relevance: 'incidental', searchesAhead: 1, appearances: 9 }, 11), 'Frequently visible, rarely above you');
  assert.equal(competitorTierLabel({ relevance: 'strong', searchesAhead: 9, appearances: 11 }, 11), 'Consistently above you');
});

test('registry ↔ WhatsApp: missing ranking/reviews are "not measured", never a number', () => {
  const f = leadMessageFacts({
    facts: { ranking: { overall: { status: 'unavailable', testedCount: 0 } }, reviews: { lifetime: { status: 'unknown', totalCount: null } } },
    profileCompletion: { completionPercentage: 0, checklist: [{ status: 'Unknown' }] },
  });
  assert.equal(f.rankText, 'not measured yet');
  assert.equal(f.reviewText, 'not measured');
  assert.equal(f.profileText, 'not measured', 'no "0%" when nothing could be checked');
});
