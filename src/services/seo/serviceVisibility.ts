/**
 * How visible EACH verified service is on Google Maps, and in each service
 * area — from measurement rows only. Pure.
 *
 * Status (no percentage is invented):
 *   strong       a measured keyword averages position 1–3 around the address
 *   moderate     best measured average is 4–10
 *   weak         found, but only below position 10
 *   not_visible  searches ran and the business was not in the top 20 in any
 *   unavailable  keywords were tracked but every search failed (provider)
 *   not_measured no keyword was tracked for this service
 * Only address-scope rows (the main grid + tracked searches) decide the
 * status; service-area rows are shown per area in the matrix.
 */
import { ADDRESS_AREA_ID, stem, words } from './ids.ts';
import type { KeywordMeasurement, MeasurementChange } from './measurements.ts';
import type { VerifiedService } from './trackedKeywords.ts';
import { competitorKey, type CompetitorFact, type SearchObservation } from '../audit/facts.ts';

export type ServiceStatus = 'strong' | 'moderate' | 'weak' | 'not_visible' | 'unavailable' | 'not_measured';

export interface ServiceKeywordView {
  id: string;
  keyword: string;
  area: string;
  avgRank: number | null;
  bestRank: number | null;
  foundCount: number;
  okCount: number;
  status: 'measured' | 'unavailable';
  change: MeasurementChange['change'] | null;
  before: string | null;
  searchVolume: number | null;
}

export interface ServiceVisibility {
  serviceId: string;
  service: string;
  state: VerifiedService['state'];
  status: ServiceStatus;
  keywords: ServiceKeywordView[];
  /** Searches behind the status (address scope) and areas measured for this service. */
  coverage: { searches: number; ok: number; areas: number };
  /** Google Business Profile search terms for this service (null = not available). */
  impressions: { total: number; period: string | null; terms: Array<{ keyword: string; impressions: number }> } | null;
  competitorsAbove: Array<{ name: string; searches: number; reviewCount: number | null; rating: number | null }>;
  /** Listed among the services on the Google profile (null = profile not read). */
  onGoogleProfile: boolean | null;
  /** Mentioned on the website's crawled pages (null = website not read). */
  onWebsite: boolean | null;
  recommendations: string[];
}

export interface MatrixCell {
  serviceId: string;
  service: string;
  areaId: string;
  area: string;
  keyword: string;
  status: 'found' | 'not_in_top_20' | 'unavailable';
  rank: number | null;
  change: MeasurementChange['change'] | null;
}

const mentions = (text: string, term: string) => {
  const tw = words(term).map(stem).filter((w) => w.length >= 4);
  const hay = new Set(words(text).map(stem));
  return tw.length > 0 && tw.every((w) => hay.has(w));
};

export function statusOf(rows: KeywordMeasurement[]): ServiceStatus {
  if (!rows.length) return 'not_measured';
  const measured = rows.filter((r) => r.status === 'measured');
  if (!measured.length) return 'unavailable';
  const avgs = measured.map((r) => r.avgRank).filter((x): x is number => x != null);
  if (!avgs.length) return 'not_visible';
  const best = Math.min(...avgs);
  return best <= 3 ? 'strong' : best <= 10 ? 'moderate' : 'weak';
}

export function buildServiceVisibility(input: {
  services: VerifiedService[];
  measurements: KeywordMeasurement[];
  changes: MeasurementChange[];
  observations: SearchObservation[];
  serviceOf: (keyword: string) => { id: string; name: string } | null;
  competitors: CompetitorFact[];
  searchTerms: Array<{ keyword: string; impressions: number; period?: string }>;
  gbpServiceNames: string[] | null;
  websiteText: string | null;
  reviewCount: number | null;
}): { services: ServiceVisibility[]; matrix: MatrixCell[] } {
  const changeOf = new Map(input.changes.map((c) => [`${c.id}@${c.areaId}`, c]));
  const counted = new Map(input.competitors.map((c) => [c.key, c]));
  const out: ServiceVisibility[] = [];
  const matrix: MatrixCell[] = [];

  for (const s of input.services) {
    const rows = input.measurements.filter((m) => m.serviceId === s.id);
    const home = rows.filter((m) => m.areaId === ADDRESS_AREA_ID);
    const status = statusOf(home);
    const keywords: ServiceKeywordView[] = home.map((m) => {
      const ch = changeOf.get(`${m.id}@${m.areaId}`);
      return { id: m.id, keyword: m.keyword, area: m.area, avgRank: m.avgRank, bestRank: m.bestRank, foundCount: m.foundCount, okCount: m.okCount, status: m.status, change: ch?.change ?? null, before: ch?.before ?? null, searchVolume: m.searchVolume };
    });

    // Same-trade competitors shown above the business in this service's searches.
    const above = new Map<string, number>();
    for (const o of input.observations) {
      if (o.status !== 'ok' || input.serviceOf(o.keyword)?.id !== s.id) continue;
      for (const r of o.ahead) {
        const k = competitorKey(r);
        if (counted.has(k)) above.set(k, (above.get(k) || 0) + 1);
      }
    }
    const competitorsAbove = Array.from(above.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, n]) => { const c = counted.get(k)!; return { name: c.name, searches: n, reviewCount: c.reviewCount, rating: c.rating }; });

    const terms = input.searchTerms.filter((t) => t.impressions > 0 && input.serviceOf(t.keyword)?.id === s.id);
    const impressions = input.searchTerms.length
      ? { total: terms.reduce((n, t) => n + t.impressions, 0), period: terms[0]?.period ?? input.searchTerms[0]?.period ?? null, terms: terms.slice(0, 5).map((t) => ({ keyword: t.keyword, impressions: t.impressions })) }
      : null;
    const onGoogleProfile = input.gbpServiceNames ? input.gbpServiceNames.some((g) => mentions(g, s.name) || mentions(s.name, g)) : null;
    const onWebsite = input.websiteText != null ? mentions(input.websiteText, s.name) : null;

    const recommendations: string[] = [];
    if (status === 'not_visible' || status === 'weak' || status === 'moderate') {
      if (onGoogleProfile === false) recommendations.push(`Add "${s.name}" to the services list on your Google Business Profile — it is not listed there now.`);
      if (onWebsite === false) recommendations.push(`Your website's crawled pages do not mention "${s.name}" — add a page or section that describes it.`);
      const top = competitorsAbove[0];
      if (top) {
        const rev = top.reviewCount != null && input.reviewCount != null && top.reviewCount > input.reviewCount
          ? ` It has ${top.reviewCount} reviews to your ${input.reviewCount} — ask customers who used ${s.name} to mention it in their review.`
          : '';
        recommendations.push(`${top.name} appeared above you in ${top.searches} search${top.searches === 1 ? '' : 'es'} for this service.${rev}`);
      }
      recommendations.push(`Publish a Google post about ${s.name} that names the service and your area.`);
    }
    if (status === 'not_measured') recommendations.push(`No keyword is tracked for "${s.name}" yet — it will be measured in the next audit.`);
    if (status === 'unavailable') recommendations.push('Ranking data was unavailable this month (provider error) — re-measured next audit; nothing is assumed.');

    const areaIds = new Set(rows.filter((m) => m.areaId !== ADDRESS_AREA_ID).map((m) => m.areaId));
    out.push({
      serviceId: s.id, service: s.name, state: s.state, status, keywords,
      coverage: { searches: home.reduce((n, m) => n + m.points, 0), ok: home.reduce((n, m) => n + m.okCount, 0), areas: areaIds.size },
      impressions, competitorsAbove, onGoogleProfile, onWebsite, recommendations: recommendations.slice(0, 4),
    });

    for (const m of rows.filter((r) => r.areaId !== ADDRESS_AREA_ID)) {
      const ch = changeOf.get(`${m.id}@${m.areaId}`);
      matrix.push({
        serviceId: s.id, service: s.name, areaId: m.areaId, area: m.area, keyword: m.keyword,
        status: m.status !== 'measured' ? 'unavailable' : m.bestRank != null ? 'found' : 'not_in_top_20',
        rank: m.bestRank, change: ch?.change ?? null,
      });
    }
  }
  return { services: out, matrix };
}

/** Measured lines for the SEO Brain (every number from stored measurements). */
export function serviceStrategyLines(services: ServiceVisibility[], matrix: MatrixCell[]): string[] {
  const label: Record<ServiceStatus, string> = {
    strong: 'strong (average position 1–3)', moderate: 'moderate (best average position 4–10)', weak: 'weak (only below position 10)',
    not_visible: 'not in the top 20', unavailable: 'ranking unavailable this month', not_measured: 'not measured yet',
  };
  const lines = services.map((s) => {
    const kw = s.keywords.filter((k) => k.status === 'measured').slice(0, 2).map((k) => `"${k.keyword}" ${k.avgRank != null ? `#${k.avgRank}` : 'not in top 20'}${k.change && k.change !== 'new' && k.change !== 'not_comparable' ? ` (${k.change})` : ''}`);
    const imp = s.impressions?.total ? `; ${s.impressions.total} Google search impressions` : '';
    return `Service "${s.service}": ${label[s.status]}${kw.length ? ` — ${kw.join(', ')}` : ''}${imp}`;
  });
  const gaps = matrix.filter((c) => c.status === 'not_in_top_20').slice(0, 4).map((c) => `${c.service} in ${c.area}`);
  if (gaps.length) lines.push(`Service-area gaps (not in the top 20): ${gaps.join('; ')}`);
  return lines.slice(0, 10);
}
