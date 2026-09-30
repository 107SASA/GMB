'use client';

/**
 * The rendered free report (everything shown once an audit is COMPLETED).
 * Split out of app/free-report/result/page.tsx so the exact customer-facing
 * markup can be rendered from a stored audit in tests and QA scripts; the
 * page keeps the polling / pricing and passes them in.
 *
 * Every value here comes from auditData.facts (services/audit/facts.ts) via
 * the shared display vocabulary (services/audit/reportDisplay.ts). Audits
 * from before the facts layer fall back to their stored fields and carry a
 * legacy notice.
 */

import Link from 'next/link';
import AuditPaywallSidebar from '@/components/audit/AuditPaywallSidebar';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { FaqAccordion } from '@/components/shared/FaqAccordion';
import { ALL_FAQS } from '@/lib/faqData';
import ConsultantSections from '@/components/audit/ConsultantSections';
import { GROWWMATICS_CAPABILITIES, type Capability } from '@/services/audit/findings';
import {
  ACTIONABILITY_LABEL,
  LEGACY_REPORT_NOTICE,
  RANK_BAND_HEX,
  RANK_LEGEND,
  SEVERITY_LABEL,
  completionBreakdown,
  completionSentence,
  isLegacyAudit,
  rankBand,
  rankLabel,
  rankingStatRows,
  reviewDisplay,
  toRankValue,
  type RankValue,
} from '@/services/audit/reportDisplay';

export interface FreeReportAudit {
  _id: string;
  status: string;
  businessName: string;
  location: string;
  website?: string;
  auditData?: any;
}

export interface FreeReportPricing {
  heroPrice?: number | null;
  heroCycleLabel?: string;
  heroDailyRate?: number | null;
  cycle?: string;
}

function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-9 h-9 bg-primary-fixed rounded-xl flex items-center justify-center">
        <MaterialIcon name={icon} size={16} className="text-primary" />
      </div>
      <h2 className="font-heading text-lg font-bold text-on-surface">{title}</h2>
    </div>
  );
}

function ChecklistIcon({ status }: { status: string }) {
  if (status === 'Complete') return <MaterialIcon name="check_circle" size={20} className="text-secondary shrink-0" />;
  if (status === 'Missing') return <MaterialIcon name="cancel" size={20} className="text-error shrink-0" />;
  if (status === 'Partial') return <MaterialIcon name="warning" size={20} className="text-warning-text shrink-0" />;
  return <MaterialIcon name="help" size={20} className="text-outline shrink-0" />;
}

function RankBadge({ value }: { value: RankValue }) {
  return (
    <span className="font-heading text-2xl font-bold" style={{ color: RANK_BAND_HEX[rankBand(value)] }}>
      {rankLabel(value)}
    </span>
  );
}

/** Bar scaled inversely to a FOUND rank; not-found/unavailable get a stub. */
function RankBar({ value }: { value: RankValue }) {
  const found = value.state === 'found';
  const pct = found ? Math.max(6, Math.round(((21 - (value.rank as number)) / 20) * 100)) : 4;
  return (
    <div className="h-1.5 rounded-full bg-surface-container overflow-hidden w-full">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: RANK_BAND_HEX[rankBand(value)] }} />
    </div>
  );
}

function StatGrid({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {rows.map((r) => (
        <div key={r.label} className="bg-surface-container rounded-lg px-3 py-2">
          <div className="text-[11px] text-on-surface-variant">{r.label}</div>
          <div className="text-sm font-bold text-on-surface">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 px-3 py-2 text-[11px] text-on-surface-variant bg-surface-container">
      {RANK_LEGEND.map((l) => (
        <span key={l.band} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: l.hex }} /> {l.label}
        </span>
      ))}
    </div>
  );
}

function FixTags({ finding }: { finding: any }) {
  const cap = finding.growwmaticsCapability as Capability | null | undefined;
  return (
    <span className="flex flex-wrap gap-1.5 mt-1">
      {finding.severity && (
        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">
          {SEVERITY_LABEL[finding.severity] || finding.severity} priority
        </span>
      )}
      {finding.actionability && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">
          {ACTIONABILITY_LABEL[finding.actionability] || finding.actionability}
        </span>
      )}
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-fixed text-primary">
        {cap && GROWWMATICS_CAPABILITIES[cap] ? `GrowwMatics: ${GROWWMATICS_CAPABILITIES[cap].label}` : 'Changed by you in Google — not automated by GrowwMatics'}
      </span>
    </span>
  );
}

export default function FreeReportView({ audit, pricing = {} }: { audit: FreeReportAudit; pricing?: FreeReportPricing }) {
  const d = audit.auditData || {};
  const facts = d.facts;
  const legacy = isLegacyAudit(d);
  const reviews = d.reviewAnalysis || {};
  const priorityFixes = d.priorityFixes || [];
  const strengths = d.strengths || [];
  const weaknesses = d.weaknesses || [];
  const aiUnavailable = d.aiStatus?.analysis === 'failed';
  const checklist: Array<{ field: string; status: string }> = d.profileCompletion?.checklist || [];
  const knownChecklist = checklist.filter((c) => c.status !== 'Unknown');
  const unknownFields = checklist.filter((c) => c.status === 'Unknown').map((c) => c.field);
  const completion = completionBreakdown(checklist);
  const seoPlanDraft = d.seoPlanDraft;
  const keywordTable = d.keywordTable || [];
  const areasChecked: string[] = d.areasChecked || [];

  // ── Ranking (facts) ────────────────────────────────────────────────────
  const overall = facts?.ranking?.overall;
  const rankingStatus: 'ok' | 'unavailable' | 'not_measured' | 'none' = facts
    ? facts.ranking?.notRunReason ? 'not_measured'
      : overall && (overall.status === 'ok' || overall.status === 'partial') ? 'ok' : overall?.status === 'unavailable' ? 'unavailable' : 'none'
    : d.googleSearchRank?.averageRank > 0 ? 'ok' : 'none';
  const headlineRank: RankValue = facts
    ? overall?.averageObservedRank != null ? { state: 'found', rank: overall.averageObservedRank } : { state: rankingStatus === 'ok' ? 'not_found' : 'unavailable', rank: null }
    : toRankValue(d.googleSearchRank?.averageRank);
  const mapKw = d.geoGridRank?.keywords?.[0];
  const mapPoints: any[] = mapKw?.points || [];
  const byKeyword: any[] = facts?.ranking?.byKeyword || [];
  const nearbyRows = byKeyword.filter((k) => k.kind === 'nearby');
  const otherRows = byKeyword.filter((k) => k.kind === 'discovery');
  const brandRows = byKeyword.filter((k) => k.kind === 'brand');
  const kwValue = (k: any): RankValue =>
    k.status === 'unavailable' ? { state: 'unavailable', rank: null }
      : k.averageObservedRank != null ? { state: 'found', rank: k.averageObservedRank } : { state: 'not_found', rank: null };
  const legacyKeywordRows: any[] = !facts ? (d.googleSearchRank?.topKeywords || []) : [];

  // ── Competitors: real businesses observed above you ────────────────────
  const localCompetitors: any[] = d.localPackCompetitors || [];
  const competitorsAhead: number = facts
    ? (rankingStatus === 'ok' ? facts.competitorsAhead?.count ?? 0 : 0)
    : localCompetitors.length;
  const searchesChecked: number = facts?.competitorsAhead?.searchesChecked ?? 0;
  const competitorFacts: any[] = Array.isArray(d.competitors) ? d.competitors : [];

  // ── Issues: verified findings (new) / stored checklist gaps (legacy) ──
  const issues: Array<{ title: string; evidence?: string; finding?: any }> = Array.isArray(d.findings)
    // Verification steps (built from data we could not check) are not issues.
    ? d.findings.filter((f: any) => f.category !== 'data_quality' && !f.verificationOnly).map((f: any) => ({ title: f.title, evidence: f.evidence, finding: f }))
    : checklist.filter((c) => c.status === 'Missing').map((c) => ({ title: `${c.field} is missing on the listing` }));

  const reviewView = reviewDisplay(facts?.reviews, d.reviewAnalysis?.reviewThemes === 'from-review-text'
    ? { praises: reviews.mostCommonPraises, complaints: reviews.mostCommonComplaints }
    : 'unknown');
  const lifetimeCount: number | null = typeof reviews.reviewCount === 'number' ? reviews.reviewCount : null;
  const lifetimeRating: number | null = typeof reviews.averageRating === 'number' && reviews.averageRating > 0 ? reviews.averageRating : null;

  const location = audit.location;
  const city = location?.split(',')[0]?.trim() || 'your area';
  const checkoutHref = `/checkout?${new URLSearchParams({
    ...(pricing.cycle ? { cycle: pricing.cycle } : {}),
    return: `/free-report/result?auditId=${audit._id}`,
  })}`;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-surface-container-lowest border-b border-outline-variant px-6 py-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <MaterialIcon name="bolt" size={16} className="text-on-primary" />
          </div>
          <span className="font-heading font-bold text-on-surface">GrowwMatics AI</span>
          <span className="text-outline mx-2">·</span>
          <span className="text-sm text-on-surface-variant">Your Free Business Report</span>
        </div>
        <Link href="/free-report" className="text-sm font-medium text-primary hover:underline shrink-0">
          Change business
        </Link>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col lg:flex-row gap-8 items-start">
        <div className="flex-1 space-y-8 w-full">
          {legacy && (
            <div className="rounded-xl border border-outline-variant bg-surface-container p-4 text-sm text-on-surface-variant">
              {LEGACY_REPORT_NOTICE}
            </div>
          )}

          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8">
            <div className="mb-1">
              <span className="text-xs font-bold uppercase tracking-wide text-error">
                Report ready · {issues.length} verified issue{issues.length === 1 ? '' : 's'} found
              </span>
            </div>
            <h1 className="font-heading text-3xl font-bold text-on-surface mb-1">{audit.businessName}</h1>
            <div className="flex items-center gap-2 text-on-surface-variant text-sm mb-3">
              <MaterialIcon name="location_on" size={16} />
              <span>{audit.location}</span>
            </div>
            {lifetimeCount != null && (
              <div className="flex items-center gap-1.5 text-sm mb-2">
                <MaterialIcon name="star" size={16} className="text-primary" filled />
                {lifetimeRating != null && <span className="font-bold text-on-surface">{lifetimeRating.toFixed(1)}</span>}
                <span className="text-outline">({lifetimeCount.toLocaleString('en-IN')} Google review{lifetimeCount === 1 ? '' : 's'})</span>
              </div>
            )}
            {audit.website && (
              <div className="flex items-center gap-2 text-primary text-sm mb-5">
                <MaterialIcon name="language" size={16} className="text-primary" />
                <a href={audit.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {audit.website}
                </a>
              </div>
            )}

            {competitorsAhead > 0 && (
              <div className="pt-5 border-t border-outline-variant">
                <h2 className="font-heading text-2xl font-bold text-on-surface mb-2">
                  {competitorsAhead} business{competitorsAhead > 1 ? 'es' : ''} showed up above {audit.businessName} on Google Maps.
                </h2>
                <p className="text-on-surface-variant text-sm mb-6">
                  {searchesChecked > 0
                    ? `In the ${searchesChecked} Google Maps searches we ran around ${city}, these businesses appeared before yours.`
                    : `In the Google Maps searches we ran around ${city}, these businesses appeared before yours.`}{' '}
                  The priority actions below show what you can start on.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <div className="bg-error-container rounded-xl p-4 text-center border border-error-container">
                    <div className="font-heading text-2xl font-bold text-error">{competitorsAhead}</div>
                    <div className="text-xs text-on-surface-variant mt-1">Businesses shown above you</div>
                  </div>
                  <div className="bg-primary-fixed rounded-xl p-4 text-center border border-primary-fixed-dim">
                    <div className="font-heading text-2xl font-bold text-primary">{issues.length}</div>
                    <div className="text-xs text-on-surface-variant mt-1">Verified issues found</div>
                  </div>
                  <div className="bg-surface-container rounded-xl p-4 text-center border border-outline-variant">
                    <div className="font-heading text-2xl font-bold text-on-surface">{completion.pct != null ? `${completion.pct}%` : 'Unknown'}</div>
                    <div className="text-xs text-on-surface-variant mt-1">of checked profile fields complete</div>
                  </div>
                </div>
                <Link
                  href={checkoutHref}
                  className="block w-full text-center py-4 bg-primary text-on-primary rounded-lg font-bold hover:bg-primary-container transition-all card-shadow"
                >
                  Fix My Google Profile
                  <span className="block text-xs font-normal opacity-90 mt-0.5">
                    {pricing.heroPrice != null
                      ? <>Start today · ₹{pricing.heroPrice.toLocaleString('en-IN')} / {pricing.heroCycleLabel}{pricing.heroDailyRate != null ? ` · ₹${pricing.heroDailyRate} a day` : ''}</>
                      : 'Start today'}
                  </span>
                </Link>
              </div>
            )}
          </div>

          {/* ── Google Search Ranking ─────────────────────────────────── */}
          {rankingStatus === 'unavailable' && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <SectionHeader title="Google Search Ranking" icon="leaderboard" />
              <p className="text-sm text-on-surface-variant">
                We couldn&apos;t complete the ranking check for this report, so your Google Maps position is unknown right now. This is a data problem on our side, not a finding about your business.
              </p>
            </div>
          )}

          {rankingStatus === 'not_measured' && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <SectionHeader title="Google Search Ranking" icon="leaderboard" />
              <p className="text-sm text-on-surface-variant">
                Not measured. Google lists {audit.businessName} only under a generic category, so there is no customer search term we can rank you for — and ranking for your own business name would only measure people who already know you. Tell us your main service (or set a specific primary category in Google) and we&apos;ll measure it.
              </p>
            </div>
          )}

          {rankingStatus === 'ok' && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <SectionHeader title="Google Search Ranking" icon="leaderboard" />
              <div className="flex items-center gap-6 mb-5">
                <RankBadge value={headlineRank} />
                <div>
                  <div className="text-sm font-medium text-on-surface">Average observed position</div>
                  <div className="text-xs text-on-surface-variant mt-0.5">
                    {facts
                      ? 'Averaged only over the searches where you appeared in the top 20.'
                      : `Where ${audit.businessName} shows up when people search near your business.`}
                  </div>
                </div>
              </div>
              {facts && <div className="mb-5"><StatGrid rows={rankingStatRows(overall)} /></div>}

              {mapPoints.length > 0 && (
                <div className="mb-5 rounded-lg overflow-hidden border border-outline-variant">
                  <div className="px-3 py-2 text-xs text-on-surface-variant bg-surface-container border-b border-outline-variant">
                    <span className="font-semibold text-on-surface">Map / grid results</span>
                    {mapKw?.keyword && <> · searching for &quot;{mapKw.keyword}&quot; from {mapPoints.length} point{mapPoints.length === 1 ? '' : 's'} around your business</>}
                  </div>
                  <img
                    src={`/api/google/static-map?points=${encodeURIComponent(JSON.stringify(mapPoints))}`}
                    alt="Map of search positions around your business"
                    className="w-full h-auto block"
                    loading="lazy"
                  />
                  <Legend />
                  {facts?.ranking?.primary && (
                    <div className="px-3 py-2.5 text-xs text-on-surface bg-surface-container-lowest border-t border-outline-variant">
                      Top 5 at <strong>{facts.ranking.primary.top5Count}</strong> of <strong>{facts.ranking.primary.testedCount}</strong> map points ·
                      top 3 at <strong>{facts.ranking.primary.top3Count}</strong> · found in the top 20 at <strong>{facts.ranking.primary.foundCount}</strong>.
                    </div>
                  )}
                </div>
              )}

              {facts && nearbyRows.length > 0 && (
                <div className="mb-5">
                  <div className="text-xs font-semibold text-on-surface mb-2">
                    Nearby-area keyword results
                    {facts.ranking?.nearby?.testedCount > 0 && (
                      <span className="font-normal text-on-surface-variant">
                        {' '}· top 5 in {facts.ranking.nearby.top5Count} of {facts.ranking.nearby.testedCount} · found in {facts.ranking.nearby.foundCount} of {facts.ranking.nearby.testedCount}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {nearbyRows.map((k: any) => (
                      <div key={k.keyword} className="flex items-center gap-3 text-sm">
                        <span className="text-on-surface-variant flex-1 truncate">{k.keyword}</span>
                        <div className="w-28"><RankBar value={kwValue(k)} /></div>
                        <span className="text-xs font-bold text-on-surface w-20 text-right">{rankLabel(kwValue(k))}</span>
                      </div>
                    ))}
                  </div>
                  {areasChecked.length > 0 && (
                    <p className="text-xs text-on-surface-variant mt-2">Areas checked: {areasChecked.join(', ')}.</p>
                  )}
                </div>
              )}

              {facts && otherRows.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-on-surface mb-2">Other keywords checked</div>
                  <div className="space-y-2">
                    {otherRows.map((k: any) => (
                      <div key={k.keyword} className="flex items-center gap-3 text-sm">
                        <span className="text-on-surface-variant flex-1 truncate">{k.keyword}</span>
                        <div className="w-28"><RankBar value={kwValue(k)} /></div>
                        <span className="text-xs font-bold text-on-surface w-20 text-right">{rankLabel(kwValue(k))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {facts && brandRows.length > 0 && (
                <div className="mt-5">
                  <div className="text-xs font-semibold text-on-surface mb-2">
                    Searches for your own name <span className="font-normal text-on-surface-variant">· not counted above — they measure brand lookups, not new customers</span>
                  </div>
                  <div className="space-y-2">
                    {brandRows.map((k: any) => (
                      <div key={k.keyword} className="flex items-center gap-3 text-sm">
                        <span className="text-on-surface-variant flex-1 truncate">{k.keyword}</span>
                        <span className="text-xs font-bold text-on-surface w-20 text-right">{rankLabel(kwValue(k))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!facts && legacyKeywordRows.length > 0 && (
                <div className="space-y-3">
                  {legacyKeywordRows.slice(0, 5).map((k: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="text-on-surface-variant flex-1 truncate">{k.keyword}</span>
                      <div className="w-28"><RankBar value={toRankValue(k.rank)} /></div>
                      <span className="text-xs font-bold text-on-surface w-20 text-right">{rankLabel(toRankValue(k.rank))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Businesses shown above you ────────────────────────────── */}
          {localCompetitors.length > 0 && rankingStatus === 'ok' && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <SectionHeader title="Businesses shown above you" icon="emoji_events" />
              <p className="text-sm text-on-surface-variant -mt-3 mb-5">
                Real Google Maps listings that appeared above {audit.businessName} in the searches we ran.
              </p>
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm min-w-90">
                  <thead>
                    <tr className="text-left text-xs text-outline uppercase tracking-wide">
                      <th className="px-2 py-2 font-medium">Business</th>
                      <th className="px-2 py-2 font-medium">Rating</th>
                      <th className="px-2 py-2 font-medium">Reviews</th>
                      <th className="px-2 py-2 font-medium">{facts ? 'Above you in' : 'Avg rank'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {localCompetitors.slice(0, 5).map((c: any, i: number) => {
                      const cf = competitorFacts.find((x: any) => x.name === c.name);
                      return (
                        <tr key={i} className="border-t border-outline-variant">
                          <td className="px-2 py-3 font-medium text-on-surface">{c.name}</td>
                          <td className="px-2 py-3 text-primary">{c.rating != null ? `★ ${Number(c.rating).toFixed(1)}` : 'Unknown'}</td>
                          <td className="px-2 py-3 text-secondary">{c.reviewCount ?? 'Unknown'}</td>
                          <td className="px-2 py-3 font-semibold text-on-surface">
                            {facts
                              ? cf ? `${cf.searchesAhead} of ${searchesChecked} searches` : '—'
                              : rankLabel(toRankValue(c.avgRank))}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-primary bg-primary-fixed/40">
                      <td className="px-2 py-3 font-bold text-on-surface">{audit.businessName}</td>
                      <td className="px-2 py-3 text-primary font-bold">{lifetimeRating != null ? `★ ${lifetimeRating.toFixed(1)}` : 'Unknown'}</td>
                      <td className="px-2 py-3 text-secondary font-bold">{lifetimeCount ?? 'Unknown'}</td>
                      <td className="px-2 py-3 font-bold text-primary">{facts ? `Avg ${rankLabel(headlineRank)}` : rankLabel(headlineRank)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {competitorsAhead > 5 && (
                <p className="mt-3 text-sm font-medium text-primary italic">
                  {competitorsAhead - 5} more business{competitorsAhead - 5 === 1 ? '' : 'es'} appeared above you…
                </p>
              )}
              <Link
                href={checkoutHref}
                className="mt-4 block w-full text-center py-3 bg-primary text-on-primary rounded-lg font-bold hover:bg-primary-container transition-all"
              >
                Beat Your Competitors →
              </Link>
            </div>
          )}

          {/* ── Verified issues ───────────────────────────────────────── */}
          {issues.length > 0 && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <SectionHeader title={`Issues we verified for ${audit.businessName}`} icon="warning" />
              <ul className="space-y-4">
                {issues.map((it, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-on-surface">
                    <MaterialIcon name="cancel" size={16} className="text-error mt-0.5 shrink-0" />
                    <span>
                      {it.title}
                      {it.evidence && <span className="block text-xs text-on-surface-variant mt-0.5">Evidence: {it.evidence}</span>}
                      {it.finding && <FixTags finding={it.finding} />}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href={checkoutHref}
                className="mt-5 block w-full text-center py-3 bg-primary text-on-primary rounded-lg font-bold hover:bg-primary-container transition-all"
              >
                See How We Fix These Issues →
              </Link>
            </div>
          )}

          {/* ── Reviews ───────────────────────────────────────────────── */}
          {(lifetimeCount != null || facts?.reviews) && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <SectionHeader title="Review Analytics" icon="star" />
              {facts ? (
                <>
                  <StatGrid
                    rows={[
                      { label: 'Lifetime Google reviews', value: reviewView.lifetimeCount },
                      { label: 'Lifetime rating', value: reviewView.lifetimeRating },
                      { label: `New reviews (${reviewView.recentPeriod})`, value: reviewView.recentCount },
                      { label: 'Reviews per week', value: reviewView.reviewsPerWeek },
                      { label: 'Recent reviews with a reply', value: reviewView.responseRate },
                    ]}
                  />
                  <p className="text-xs text-on-surface-variant mt-3">{reviewView.themes}</p>
                </>
              ) : (
                <StatGrid
                  rows={[
                    { label: 'Total reviews', value: lifetimeCount != null ? String(lifetimeCount) : 'Unknown' },
                    { label: 'Average rating', value: lifetimeRating != null ? lifetimeRating.toFixed(1) : 'Unknown' },
                  ]}
                />
              )}
            </div>
          )}

          {/* ── Profile completion ────────────────────────────────────── */}
          {checklist.length > 0 && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <SectionHeader title="Profile Completion" icon="check_circle" />
              <div className="mb-5">
                <p className="text-sm text-on-surface-variant mb-2">{completionSentence(completion)}</p>
                <div className="h-2 rounded-full bg-surface-container overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, completion.pct ?? 0)}%` }} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                {knownChecklist.map((c, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-sm">
                    <ChecklistIcon status={c.status} />
                    <span className={c.status === 'Missing' ? 'text-on-surface font-medium' : 'text-on-surface-variant'}>{c.field}</span>
                  </div>
                ))}
              </div>
              {unknownFields.length > 0 && (
                <div className="mt-4 pt-4 border-t border-outline-variant flex items-start gap-2 text-xs text-outline">
                  <MaterialIcon name="help" size={16} className="shrink-0" />
                  <span>Could not be checked (not counted): {unknownFields.join(', ')}.</span>
                </div>
              )}
            </div>
          )}

          {/* ── Priority action items ─────────────────────────────────── */}
          {priorityFixes.length > 0 && (
            <div>
              <SectionHeader title="Priority Action Items" icon="warning" />
              <div className="space-y-3">
                {priorityFixes.map((fix: any, idx: number) => (
                  <div key={idx} className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5">
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 bg-primary-fixed rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-primary">{idx + 1}</span>
                      </div>
                      <div>
                        <h3 className="font-heading font-semibold text-on-surface mb-1">{fix.title}</h3>
                        {fix.evidence && <p className="text-sm text-on-surface"><span className="font-semibold">Fact: </span>{fix.evidence}</p>}
                        {fix.reason && <p className="text-sm text-on-surface-variant mt-0.5"><span className="font-semibold text-on-surface">What it means: </span>{fix.reason}</p>}
                        {fix.recommendedAction && <p className="text-sm text-on-surface-variant mt-0.5"><span className="font-semibold text-on-surface">Recommended: </span>{fix.recommendedAction}</p>}
                        {fix.actionability && (
                          <FixTags finding={{ severity: fix.impact?.toLowerCase(), actionability: fix.actionability, growwmaticsCapability: fix.growwmaticsCapability }} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {facts && strengths.length === 0 && weaknesses.length === 0 && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <SectionHeader title="Strengths & Areas to Improve" icon="thumb_up" />
              <p className="text-sm text-on-surface-variant">
                {aiUnavailable
                  ? 'Additional AI analysis is temporarily unavailable. The measured results in this report are unaffected.'
                  : 'No strengths or weaknesses could be stated beyond the verified issues above — nothing is listed without evidence.'}
              </p>
            </div>
          )}
          {(strengths.length > 0 || weaknesses.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {strengths.length > 0 && (
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
                  <SectionHeader title="Strengths" icon="thumb_up" />
                  <ul className="space-y-3">
                    {strengths.map((s: any, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <MaterialIcon name="check_circle" size={16} className="text-secondary mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-semibold text-on-surface">{s.title}</div>
                          {s.evidence && <div className="text-xs text-on-surface-variant">{s.evidence}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {weaknesses.length > 0 && (
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
                  <SectionHeader title="Areas to Improve" icon="thumb_down" />
                  <ul className="space-y-3">
                    {weaknesses.map((w: any, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <MaterialIcon name="warning" size={16} className="text-warning-text mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-semibold text-on-surface">{w.title}</div>
                          {w.evidence && <div className="text-xs text-on-surface-variant">{w.evidence}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {seoPlanDraft && (
            <ConsultantSections
              draft={seoPlanDraft}
              keywordTable={keywordTable}
              businessName={audit.businessName}
              city={city}
              checkoutHref={checkoutHref}
            />
          )}

          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
            <SectionHeader title="Common questions" icon="help" />
            <FaqAccordion faqs={ALL_FAQS} defaultOpenIndex={null} />
          </div>
        </div>

        <div id="unlock">
          <AuditPaywallSidebar
            unlockHeadline="Your report is free to keep. Unlock the full detailed report — every issue, every keyword gap, and a step-by-step action plan — plus the whole platform."
            showComparison
            sticky={false}
            promoStyle
          />
        </div>
      </div>
    </div>
  );
}
