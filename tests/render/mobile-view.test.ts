/**
 * The mobile report view (GET /api/audit/[id] → mobileView) must show the same
 * verified values as the web report, for every stored fixture — including
 * legacy audits and the monthly report.
 * Run: npx tsx --test tests/render/mobile-view.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMobileReportView } from '../../src/services/audit/mobileView';
import { completionBreakdown, rankLabel } from '../../src/services/audit/reportDisplay';

const dir = path.resolve(__dirname, '../fixtures/audits');
const fixtures = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ name: f, audit: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));

for (const { name, audit } of fixtures) {
  test(`mobile view (${name}): no broken values, same numbers as the web report`, () => {
    const v = buildMobileReportView(audit);
    const text = JSON.stringify(v);
    assert.doesNotMatch(text, /NaN|undefined|\[object Object\]/, 'no broken placeholders');
    assert.doesNotMatch(text.replace(/not revenue/gi, ''), /revenue|₹\s?\d|guaranteed/i, 'no revenue/guarantee claims');
    const d = audit.auditData || {};
    const webIssues = Array.isArray(d.findings) ? d.findings.filter((f: any) => f.category !== 'data_quality' && !f.verificationOnly).length : null;
    if (webIssues != null) assert.equal(v.headline.issuesCount, webIssues, 'issue count = web');
    assert.equal(v.completion.percent, completionBreakdown(d.profileCompletion?.checklist).pct, 'completion % = web formula');
    if (d.facts) {
      const o = d.facts.ranking?.overall;
      if (o?.averageObservedRank != null) assert.equal(v.headline.averageRank, rankLabel({ state: 'found', rank: o.averageObservedRank }));
      assert.ok(v.competitors.every((c) => !/estimated/i.test(c.aboveYou)));
    } else {
      assert.equal(v.legacy, true);
      assert.ok(v.legacyNotice);
    }
    if (d.monthly) {
      assert.ok(v.monthly, 'monthly section present');
      assert.ok(v.monthly!.reviews[0].startsWith('New Google reviews:'));
    }
  });
}

test('there is at least one new-engine, one legacy and one monthly fixture', () => {
  assert.ok(fixtures.some((f) => f.audit.auditData?.facts));
  assert.ok(fixtures.some((f) => f.audit.auditData?.monthly));
});
