/**
 * Shared query scope for the SuperAdmin Conversion Dashboard
 * (/admin/pipeline, /admin/leads, /admin/conversion-analytics, served by
 * /api/admin/conversion/*).
 *
 * SOURCE OF TRUTH — built on the Lead Engine (Lead tenantId
 * 'gmbboost-internal' + LeadEvent + DemoBooking), not the legacy
 * Business.pipelineStage funnel. Stage, milestone and segment definitions
 * live in lib/admin/leadMilestones.ts; this file is the tenant scope and the
 * date window.
 *
 * The date window is always "leads CREATED in this window" — a cohort — and
 * every number on a page uses the same window. The default is all time.
 */
import { currentFunnelStage } from './leadMilestones.ts';

/** The one tenant every query here is locked to. */
export const PLATFORM_TENANT = 'gmbboost-internal';
export const PLATFORM_LEAD_MATCH = { tenantId: PLATFORM_TENANT } as const;

export type DateRangeKey = 'today' | '7d' | '30d' | '90d' | 'all' | 'custom';

export const DEFAULT_RANGE: DateRangeKey = 'all';

export interface ResolvedRange {
  key: DateRangeKey;
  /** Inclusive lower bound, or null for "all time". */
  since: Date | null;
  until: Date | null;
}

const validDate = (v: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Parses ?range= / ?from= / ?to= into a concrete window. Defaults to all time. */
export function resolveDateRange(params: URLSearchParams, now = new Date()): ResolvedRange {
  const key = (params.get('range') || DEFAULT_RANGE) as DateRangeKey;
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  if (key === 'custom') {
    const since = validDate(params.get('from'));
    let until = validDate(params.get('to'));
    // A bare date ("2026-10-25") means the whole of that day.
    if (until && /^\d{4}-\d{2}-\d{2}$/.test(params.get('to') || '')) until = new Date(until.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { key, since, until };
  }
  if (key === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { key, since: start, until: null };
  }
  const map: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
  if (map[key]) return { key, since: daysAgo(map[key]), until: null };
  return { key: 'all', since: null, until: null };
}

/** A `createdAt` filter fragment for a resolved range (empty when "all"). */
export function createdAtFilter(range: ResolvedRange): Record<string, unknown> {
  if (!range.since && !range.until) return {};
  const f: Record<string, Date> = {};
  if (range.since) f.$gte = range.since;
  if (range.until) f.$lte = range.until;
  return { createdAt: f };
}

/** "Leads created in the last 30 days" — the scope line every page shows. */
export function rangeScopeLabel(key: string): string {
  switch (key) {
    case 'today': return 'Leads created today';
    case '7d': return 'Leads created in the last 7 days';
    case '30d': return 'Leads created in the last 30 days';
    case '90d': return 'Leads created in the last 90 days';
    case 'custom': return 'Leads created in the chosen dates';
    default: return 'All leads (all time)';
  }
}

/** Combines the platform-tenant match with an optional extra filter. */
export function scoped(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...PLATFORM_LEAD_MATCH, ...extra };
}

/** One label for where a lead is now (lib/admin/leadMilestones.ts). */
export const deriveFunnelStage = currentFunnelStage;
