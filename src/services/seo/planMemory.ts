/**
 * What a new SEO plan version remembers from its audit's measurements, for
 * the weekly content engine and the next month's plan. Pure.
 */
import type { KeywordMeasurement } from './measurements.ts';
import type { MatrixCell, ServiceVisibility } from './serviceVisibility.ts';

/** Tracked and service-area measurements (non-grid) as keyword-table rows the content engine already reads. */
export function trackedKeywordRows(measurements: KeywordMeasurement[]): any[] {
  return measurements
    .filter((m) => m.scope !== 'address_grid')
    .map((m) => ({
      keyword: m.keyword,
      rank: m.avgRank,
      mapsRank: m.avgRank,
      found: m.status === 'measured' ? m.avgRank != null : false,
      rankStatus: m.status === 'measured' ? 'ok' : 'unavailable',
      searchVolume: m.searchVolume,
      demandStatus: m.searchVolume != null ? 'measured' : 'unavailable',
      volumeBand: null,
      estimated: m.searchVolume == null,
      source: 'tracked',
      serviceId: m.serviceId,
    }));
}

export interface PlanFocus {
  /** Services to push this month, weakest measured first (not-measured last). */
  services: Array<{ serviceId: string; service: string; status: string; keyword: string | null }>;
  /** Service areas where a measured search did not find the business in the top 20. */
  areas: Array<{ area: string; services: string[] }>;
}

const ORDER: Record<string, number> = { not_visible: 0, weak: 1, moderate: 2, unavailable: 3, not_measured: 4, strong: 5 };

export function planFocus(services: ServiceVisibility[], matrix: MatrixCell[]): PlanFocus {
  const svc = services
    .filter((s) => s.status !== 'strong')
    .sort((a, b) => ORDER[a.status] - ORDER[b.status])
    .map((s) => {
      const k = [...s.keywords].filter((x) => x.status === 'measured').sort((a, b) => (b.avgRank ?? 99) - (a.avgRank ?? 99))[0];
      return { serviceId: s.serviceId, service: s.service, status: s.status, keyword: k?.keyword ?? null };
    });
  const byArea = new Map<string, Set<string>>();
  for (const c of matrix) {
    if (c.status !== 'not_in_top_20') continue;
    const set = byArea.get(c.area) || new Set<string>();
    set.add(c.service);
    byArea.set(c.area, set);
  }
  return { services: svc, areas: Array.from(byArea.entries()).map(([area, s]) => ({ area, services: Array.from(s) })) };
}
