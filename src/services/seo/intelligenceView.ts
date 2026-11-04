/**
 * Display rows for "SEO intelligence" — built from the stored
 * facts.tracking of ONE audit, shared by every report screen and the PDF so
 * they always show identical text. Pure.
 */
import type { ServiceStatus } from './serviceVisibility.ts';

export const SERVICE_STATUS_TEXT: Record<ServiceStatus, string> = {
  strong: 'Strong — average position 1–3',
  moderate: 'Moderate — best average position 4–10',
  weak: 'Weak — only below position 10',
  not_visible: 'Not in the top 20',
  unavailable: 'Ranking unavailable this month',
  not_measured: 'Not measured yet',
};

const OUTCOME_TEXT: Record<string, string> = {
  not_completed: 'Not done yet',
  not_yet_measurable: 'Done — too early to measure',
  positive: 'Done — tracked keywords improved',
  negative: 'Done — tracked keywords declined',
  no_change: 'Done — no measurable change',
  insufficient_evidence: 'Done — not enough comparable data',
};

const CHANGE_TEXT: Record<string, string> = {
  improved: '▲ improved', declined: '▼ declined', stable: '= stable', new: 'new', not_comparable: 'not comparable',
};

const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : null);
const pos = (avg: number | null, ok: number, found: number, status: string) =>
  status !== 'measured' ? 'Unavailable' : avg == null ? 'Not in top 20' : ok > 1 ? `#${avg} avg (top 20 in ${found}/${ok})` : `#${avg}`;

export interface IntelligenceView {
  period: string;
  coverage: string;
  history: null | {
    previousPlan: string | null;
    priorities: Array<{ keyword: string; result: string }>;
    actions: Array<{ action: string; outcome: string; basis: string }>;
    openActions: string[];
    movement: string;
  };
  services: Array<{
    service: string;
    source: string;
    status: string;
    statusKey: ServiceStatus;
    coverage: string;
    keywords: Array<{ keyword: string; position: string; change: string; demand: string }>;
    impressions: string | null;
    competitors: string[];
    presence: string[];
    recommendations: string[];
  }>;
  matrix: { areas: string[]; rows: Array<{ service: string; cells: Array<{ area: string; text: string; keyword: string }> }> } | null;
  keywordChanges: Array<{ keyword: string; change: string; reason: string }>;
  website: { status: string; items: Array<{ priority: string; issue: string; page: string | null; recommendation: string; evidence: string }> } | null;
}

export function intelligenceView(t: any): IntelligenceView | null {
  if (!t || !Array.isArray(t.serviceVisibility)) return null;
  const period = t.previousMeasuredAt
    ? `Measured ${date(t.measuredAt)}; compared with ${date(t.previousMeasuredAt)}`
    : `Measured ${date(t.measuredAt)} (first tracked measurement — changes appear from next month)`;
  const ms: any[] = t.measurements || [];
  const coverage = `${ms.length} keyword × location measurements from ${ms.reduce((n, m) => n + (m.points || 0), 0)} Google Maps searches (${ms.filter((m) => m.status !== 'measured').length} unavailable)`;

  const h = t.history;
  const history = h
    ? {
        previousPlan: h.previousPlanVersion != null ? `SEO plan version ${h.previousPlanVersion} (${date(h.previousPlanAt)})` : null,
        priorities: (h.previousPriorities || []).slice(0, 6),
        actions: (h.actions || []).filter((a: any) => a.completion === 'completed').slice(0, 8)
          .map((a: any) => ({ action: a.action, outcome: OUTCOME_TEXT[a.outcome] || a.outcome, basis: a.basis })),
        openActions: (h.actions || []).filter((a: any) => a.completion !== 'completed').slice(0, 8).map((a: any) => `${a.action} (${String(a.status).toLowerCase()})`),
        movement: `${h.keywords?.improving?.length ?? 0} improved · ${h.keywords?.declining?.length ?? 0} declined · ${h.keywords?.stable?.length ?? 0} stable · ${h.keywords?.new?.length ?? 0} new · ${h.keywords?.notComparable?.length ?? 0} not comparable`,
      }
    : null;

  const sourceText: Record<string, string> = { VERIFIED: 'Listed on Google', OWNER_CONFIRMED: 'From your service list', SOURCE_CLAIM: 'Stated on your website' };
  const services = (t.serviceVisibility as any[]).map((s) => ({
    service: s.service,
    source: sourceText[s.state] || s.state,
    status: SERVICE_STATUS_TEXT[s.status as ServiceStatus] || s.status,
    statusKey: s.status as ServiceStatus,
    coverage: s.coverage?.searches ? `${s.coverage.ok} of ${s.coverage.searches} searches returned results${s.coverage.areas ? ` · measured in ${s.coverage.areas} service area${s.coverage.areas === 1 ? '' : 's'}` : ''}` : 'No searches yet',
    keywords: (s.keywords || []).map((k: any) => ({
      keyword: k.keyword,
      position: pos(k.avgRank, k.okCount, k.foundCount, k.status),
      change: k.change ? `${CHANGE_TEXT[k.change] || k.change}${k.before && k.change !== 'new' ? ` (was ${k.before})` : ''}` : '—',
      demand: k.searchVolume != null && k.searchVolume > 0 ? `${k.searchVolume.toLocaleString('en-IN')}/month` : 'Not enough data',
    })),
    impressions: s.impressions == null ? null : s.impressions.total ? `${s.impressions.total} Google search impressions${s.impressions.period ? ` (${s.impressions.period})` : ''}` : 'No Google search impressions matched this service',
    competitors: (s.competitorsAbove || []).map((c: any) => `${c.name} — above you in ${c.searches} search${c.searches === 1 ? '' : 'es'}${c.reviewCount != null ? `, ${c.reviewCount} reviews` : ''}`),
    presence: [
      s.onGoogleProfile === true ? 'On your Google services list' : s.onGoogleProfile === false ? 'Missing from your Google services list' : null,
      s.onWebsite === true ? 'Mentioned on your website' : s.onWebsite === false ? 'Not found on your website’s crawled pages' : null,
    ].filter(Boolean) as string[],
    recommendations: s.recommendations || [],
  }));

  const cells: any[] = t.matrix || [];
  const areas = Array.from(new Set(cells.map((c) => c.area)));
  const matrix = cells.length
    ? {
        areas,
        rows: Array.from(new Set(cells.map((c) => c.service))).map((service) => ({
          service,
          cells: areas.map((area) => {
            const c = cells.find((x) => x.service === service && x.area === area);
            const text = !c ? 'Not measured' : c.status === 'unavailable' ? 'Unavailable' : c.status === 'found' ? `#${c.rank}` : 'Not in top 20';
            return { area, text: c?.change && c.change !== 'new' ? `${text} ${CHANGE_TEXT[c.change]?.split(' ')[0] || ''}`.trim() : text, keyword: c?.keyword || '' };
          }),
        })),
      }
    : null;

  const keywordChanges = (t.keywordChanges || []).filter((c: any) => c.change !== 'not_added').slice(0, 10)
    .map((c: any) => ({ keyword: c.keyword, change: c.change === 'added' ? 'Added' : 'Removed', reason: c.reason }));

  const w = t.websiteSeo;
  const website = w
    ? {
        status: w.status === 'measured' ? `${w.pagesChecked} crawled page${w.pagesChecked === 1 ? '' : 's'} checked — recommendations only, nothing was changed on your website` : w.reason || 'Not measured',
        items: (w.items || []).slice(0, 12).map((i: any) => ({ priority: i.priority, issue: i.issue, page: i.page, recommendation: i.recommendation, evidence: i.evidence })),
      }
    : null;

  return { period, coverage, history, services, matrix, keywordChanges, website };
}
