/**
 * Tests for the report display vocabulary, the SSRF guard, AI capability
 * claims and validation repairs (Sep 2026 report-section pass). Pure — no
 * DB, no network.
 *
 * Run with: node --experimental-strip-types --test tests/integration/report-display.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toRankValue, rankLabel, rankBand, RANK_LEGEND, RANK_BAND_HEX, staticMapColor,
  rankingStatRows, completionBreakdown, completionSentence, reviewDisplay,
  suspensionDisplay, POLICY_UNVERIFIED_NOTE, buildRankMapUrl, isLegacyAudit,
} from '../../src/services/audit/reportDisplay.ts';
import { buildObservation, summarizeRankings, buildReviewFacts, gridFromObservations, competitorsFromObservations, brandPhrase, isBrandedKeyword } from '../../src/services/audit/facts.ts';
import { claimsUnsupportedCapability, validateAudit, claimsCausation, dropUnsupportedSentences } from '../../src/services/audit/validateAudit.ts';
import { isBlockedAddress, checkUrlShape } from '../../src/lib/ssrfGuard.ts';

const obs = (rank: number | null, status: 'ok' | 'unavailable' = 'ok', kind: 'primary' | 'nearby' = 'primary', point = { lat: 22.5, lng: 88.3 }) =>
  buildObservation({
    keyword: 'kw', kind, point,
    results: status === 'unavailable' ? null : Array.from({ length: rank ?? 12 }, (_, i) => ({ name: i + 1 === rank ? 'Target' : `B${i}`, placeId: i + 1 === rank ? 't' : `b${i}` })),
    targetPosition: rank,
  });

// ── Ranking display ────────────────────────────────────────────────────────

test('found shows the real rank; not found is "Not found"; failure is "Unavailable" — never 20+/21', () => {
  assert.equal(rankLabel(toRankValue({ found: true, rank: 14, status: 'ok' })), '#14');
  assert.equal(rankLabel(toRankValue({ found: true, rank: 7.5, status: 'ok' })), '#7.5');
  assert.equal(rankLabel(toRankValue({ found: false, rank: null, status: 'ok' })), 'Not found');
  assert.equal(rankLabel(toRankValue({ found: false, rank: null, status: 'unavailable' })), 'Unavailable');
  assert.equal(rankLabel(toRankValue(21)), 'Not found', 'old stored 21 reads as Not found');
  for (const label of RANK_LEGEND.map((l) => l.label)) assert.ok(!/20\+|21/.test(label), label);
});

test('Mulsetu example: 14, 1, NF, NF, NF → average #7.5, stats share one denominator', () => {
  const s = summarizeRankings([obs(14), obs(1), obs(null), obs(null), obs(null)]);
  const rows = Object.fromEntries(rankingStatRows(s).map((r) => [r.label, r.value]));
  assert.equal(rows['Average observed rank'], '#7.5');
  assert.equal(rows['Searches measured'], '5');
  assert.equal(rows['Searches where you were found'], '2 of 5');
  assert.equal(rows['Visibility (found in top 20)'], '40%');
  assert.equal(rows['Top 3'], '20%');
  assert.equal(rows['Top 5'], '20%');
});

test('provider failure → stats say unavailable, no percentages', () => {
  const rows = rankingStatRows(summarizeRankings([obs(null, 'unavailable'), obs(null, 'unavailable')]));
  assert.equal(rows.length, 1);
  assert.match(rows[0].value, /unavailable/);
});

test('map colours come from the same bands as the legend; only real points are drawn', () => {
  assert.equal(rankBand(toRankValue({ found: true, rank: 3 })), 'top5');
  assert.equal(rankBand(toRankValue({ found: true, rank: 14 })), 'top20');
  assert.equal(rankBand(toRankValue({ found: false, rank: null })), 'not_found');
  assert.equal(rankBand(toRankValue({ found: false, rank: null, status: 'unavailable' })), 'unavailable');
  for (const l of RANK_LEGEND) assert.equal(l.hex, RANK_BAND_HEX[l.band]);
  const url = buildRankMapUrl({
    points: [
      { lat: 1, lng: 1, rank: 3, found: true, status: 'ok' },
      { lat: 2, lng: 2, rank: null, found: false, status: 'ok' },
      { lat: 3, lng: 3, rank: null, found: false, status: 'unavailable' },
    ],
    apiKey: 'K',
  });
  assert.ok(url.includes(`color:${staticMapColor('top5')}`));
  assert.ok(url.includes(`color:${staticMapColor('not_found')}`));
  assert.ok(url.includes(`color:${staticMapColor('unavailable')}`));
  assert.equal((url.match(/markers=/g) || []).length, 4, '3 real points + You — no padding to 9');
});

test('grid statistics use exactly the map points', () => {
  const grid = gridFromObservations([obs(3), obs(null), obs(null, 'unavailable'), obs(2, 'ok', 'nearby')]);
  assert.equal(grid.length, 1);
  assert.equal(grid[0].points.length, 3, 'nearby-keyword searches are not map points');
  assert.equal(grid[0].summary.testedCount, 2);
  assert.equal(grid[0].summary.top5Count, 1);
  assert.equal(grid[0].avgRank, 3);
});

// ── Profile completion ─────────────────────────────────────────────────────

test('completion: 7 known (6 complete, 1 missing), 4 unknown → 86%; unknown never lowers it', () => {
  const cl = [...Array(6).fill({ status: 'Complete' }), { status: 'Missing' }, ...Array(4).fill({ status: 'Unknown' })];
  const b = completionBreakdown(cl);
  assert.deepEqual(
    { known: b.known, complete: b.complete, missing: b.missing, unknown: b.unknown, pct: b.pct },
    { known: 7, complete: 6, missing: 1, unknown: 4, pct: 86 },
  );
  assert.equal(completionBreakdown([...cl, ...Array(10).fill({ status: 'Unknown' })]).pct, 86);
  assert.match(completionSentence(b), /6 of 7 checked fields complete \(86%\) · 1 missing · 4 could not be checked/);
  assert.equal(completionBreakdown(Array(3).fill({ status: 'Unknown' })).pct, null);
});

// ── Reviews ────────────────────────────────────────────────────────────────

test('reviews: lifetime vs recent kept apart; unsynced recent values are Unknown, themes explained', () => {
  const f = buildReviewFacts({ count: 3, rating: 5, source: 'google_places' }, { periodDays: 14, synced: false, reviews: [] });
  const r = reviewDisplay(f, 'unknown');
  assert.equal(r.lifetimeCount, '3');
  assert.equal(r.lifetimeRating, '5★');
  assert.equal(r.reviewsPerWeek, 'Unknown');
  assert.equal(r.recentCount, 'Not measured');
  assert.equal(r.responseRate, 'Unknown');
  assert.equal(r.themes, 'Review themes unavailable because review text was not available.');
  const synced = reviewDisplay(buildReviewFacts(null, { periodDays: 14, synced: true, reviews: [] }), 'unknown');
  assert.equal(synced.lifetimeCount, 'Unknown', 'no fake 0 reviews');
  assert.equal(synced.reviewsPerWeek, '0/week', '0 is real here: a synced window with no new reviews');
  assert.equal(synced.responseRate, 'No reviews in period', 'never "0%"');
});

// ── Suspension ─────────────────────────────────────────────────────────────

test('suspension: level + reason, never a %, never an unverified "no policy violations"', () => {
  const low = suspensionDisplay({ level: 'Low', reasons: [] });
  assert.equal(low.level, 'Low');
  assert.ok(low.note.includes(POLICY_UNVERIFIED_NOTE));
  assert.ok(!/violation/i.test(low.note.replace(POLICY_UNVERIFIED_NOTE, '')));
  assert.equal(suspensionDisplay(null).level, 'Not assessed');
});

test('legacy audits are recognised for the compatibility notice', () => {
  assert.equal(isLegacyAudit({ googleSearchRank: { averageRank: 21 } }), true);
  assert.equal(isLegacyAudit({ facts: { version: 1 } }), false);
});

// ── AI capability claims ───────────────────────────────────────────────────

test('AI text promising unsupported GrowwMatics actions is detected', () => {
  assert.equal(claimsUnsupportedCapability('We will add 5 new categories to your profile'), true);
  assert.equal(claimsUnsupportedCapability('GrowwMatics can update your opening hours'), true);
  assert.equal(claimsUnsupportedCapability("We'll post Q&As every week"), true);
  assert.equal(claimsUnsupportedCapability('We will publish weekly Google posts'), false, 'posts are supported');
  assert.equal(claimsUnsupportedCapability('Add your services in Google Business Profile'), false, 'owner action, no GrowwMatics claim');
});

// ── Validation repairs vs failures ─────────────────────────────────────────

test('validation repairs duplicate/self competitors and re-derives the count; fails on unrepairable problems', () => {
  const o = [buildObservation({
    keyword: 'k', kind: 'primary', targetPosition: 3,
    results: [{ name: 'A', placeId: 'a' }, { name: 'B', placeId: 'b' }, { name: 'T', placeId: 't' }],
  })];
  const comps = competitorsFromObservations(o);
  const dup = { ...comps[0] };
  const self = { ...comps[1], key: 'pid:t', placeId: 't', name: 'Target Co' };
  const base: any = {
    targetName: 'Target Co', targetPlaceId: 't', observations: o, competitors: [...comps, dup, self], competitorsAheadCount: 4,
    averageObservedRank: 3, reviews: buildReviewFacts(null, { periodDays: 14, synced: false, reviews: [] }),
    evidence: [], findings: [], suspensionRisk: { level: 'Low', reasons: [], basis: 'heuristic' }, keywordRows: [],
    checklist: [{ field: 'Phone', status: 'Complete' }, { field: 'Website', status: 'Missing' }], completionPercentage: 50,
  };
  const v = validateAudit(base);
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.equal(base.competitors.length, 2);
  assert.equal(base.competitorsAheadCount, 2);

  const bad = validateAudit({ ...base, competitors: [...comps], competitorsAheadCount: 2, completionPercentage: 80 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e: string) => e.includes('completion')));

  const rpw = validateAudit({ ...base, competitors: [...comps], competitorsAheadCount: 2, displayedReviewsPerWeek: 0.5 });
  assert.equal(rpw.ok, false, 'a reviews/week value without a synced window is a placeholder');
});

// ── SSRF guard ─────────────────────────────────────────────────────────────

test('SSRF: private, loopback, link-local/metadata, CGNAT and mapped addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '142.250.183.14', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('SSRF: URL shape rules', () => {
  assert.equal(checkUrlShape('https://example.com/').ok, true);
  assert.equal(checkUrlShape('http://example.com:80/x').ok, true);
  for (const bad of ['file:///etc/passwd', 'ftp://example.com', 'http://localhost/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://example.com:8080/', 'http://user:pw@example.com/', 'http://[::1]/', 'http://metadata.google.internal/']) {
    assert.equal(checkUrlShape(bad).ok, false, bad);
  }
});

// ── Branded searches ───────────────────────────────────────────────────────

test('own-name searches are branded (excluded from stats); category searches are not', () => {
  assert.equal(brandPhrase('Desun Academy - Top IT Training Institute in Kolkata'), 'desun academy');
  assert.equal(brandPhrase('Mulsetu'), 'mulsetu');
  assert.equal(isBrandedKeyword('Mulsetu company Ojhar', 'Mulsetu'), true);
  assert.equal(isBrandedKeyword('mulsetu ojhar', 'Mulsetu'), true);
  assert.equal(isBrandedKeyword('Desun Academy Kolkata', 'Desun Academy - Top IT Training Institute in Kolkata'), true);
  assert.equal(isBrandedKeyword('IT training institute Kolkata', 'Desun Academy - Top IT Training Institute in Kolkata'), false);
  assert.equal(isBrandedKeyword('dental clinic kolkata', 'Dental Clinic', 'dental clinic'), false, 'generic names are not brands');
});

// ── False causation ────────────────────────────────────────────────────────

test('causal ranking claims are removed sentence by sentence (seen live)', () => {
  assert.equal(claimsCausation('Desun Academy has 118 reviews versus a median of 163 among competitors, limiting its perceived authority and contributing to lower rankings.'), true);
  assert.equal(claimsCausation('The business ranks poorly because it has only 3 reviews.'), true);
  assert.equal(claimsCausation('Businesses above you have a median of 163 reviews; you have 118.'), false, 'a comparison is fine');
  assert.equal(claimsCausation("Promotional words in the title are against Google's naming guidelines."), false);
  const cleaned = dropUnsupportedSentences('It is in the top 20 in 33 of 45 searches. Few reviews are holding back its ranking. Its rating is 4.5.');
  assert.equal(cleaned, 'It is in the top 20 in 33 of 45 searches. Its rating is 4.5.');
  assert.equal(dropUnsupportedSentences('Low reviews cause lower rankings.'), undefined);
});
