/**
 * 15-day Google performance update for WhatsApp — pure (runs under `node --test`).
 *
 * Every number is a Google-measured Business Profile metric (GBPInsights,
 * synced from the Performance API): views (Search / Maps), calls, website
 * clicks, direction requests, chat conversations. The previous 15 days are
 * the comparison. A percentage is shown only when the previous value was
 * above zero; nothing is estimated, and engagement is never turned into
 * revenue or customers.
 */

export interface DailyMetrics {
  date: Date | string;
  views?: number;
  viewsSearch?: number;
  viewsMaps?: number;
  callClicks?: number;
  websiteClicks?: number;
  directionRequests?: number;
  conversations?: number;
}

export const DIGEST_DAYS = 15;
/** Google's performance data lags ~3 days; the window ends there. */
export const DATA_LAG_DAYS = 3;
const DAY = 86_400_000;

const METRICS: Array<[keyof DailyMetrics, string]> = [
  ['views', 'Total views'],
  ['viewsSearch', 'Search views'],
  ['viewsMaps', 'Maps views'],
  ['callClicks', 'Calls'],
  ['websiteClicks', 'Website clicks'],
  ['directionRequests', 'Direction requests'],
  ['conversations', 'Chats'],
];

export interface DigestRow { label: string; current: number; previous: number | null; pctChange: number | null }

export interface PerformanceDigest {
  /** null = not enough measured data to send anything. */
  rows: DigestRow[] | null;
  period: { start: string; end: string };
  previousMeasured: boolean;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Totals for the latest 15 complete days and the 15 before, from stored daily rows. */
export function buildPerformanceDigest(rows: DailyMetrics[], now: Date): PerformanceDigest {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DATA_LAG_DAYS * DAY);
  const mid = new Date(end.getTime() - DIGEST_DAYS * DAY);
  const start = new Date(mid.getTime() - DIGEST_DAYS * DAY);
  const inRange = (r: DailyMetrics, a: Date, b: Date) => { const t = new Date(r.date).getTime(); return t >= a.getTime() && t < b.getTime(); };
  const cur = rows.filter((r) => inRange(r, mid, end));
  const prev = rows.filter((r) => inRange(r, start, mid));
  const period = { start: day(mid), end: day(new Date(end.getTime() - DAY)) };
  // Need most of the window measured — a partly synced window would understate the numbers.
  if (cur.length < Math.ceil(DIGEST_DAYS * 0.8)) return { rows: null, period, previousMeasured: false };
  const previousMeasured = prev.length >= Math.ceil(DIGEST_DAYS * 0.8);
  const sum = (xs: DailyMetrics[], k: keyof DailyMetrics) => xs.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const out: DigestRow[] = METRICS.map(([k, label]) => {
    const c = sum(cur, k);
    const p = previousMeasured ? sum(prev, k) : null;
    return { label, current: c, previous: p, pctChange: p != null && p > 0 ? Math.round(((c - p) / p) * 100) : null };
  });
  return { rows: out, period, previousMeasured };
}

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The WhatsApp text. Rows with zero now and zero before are left out (noise); the total is always shown. */
export function composePerformanceDigest(d: PerformanceDigest, businessName: string, link: string): string | null {
  if (!d.rows) return null;
  const lines = [`📈 Your Google profile — last ${DIGEST_DAYS} days (${fmtDate(d.period.start)}–${fmtDate(d.period.end)})`, businessName, ''];
  for (const r of d.rows) {
    if (r.label !== 'Total views' && r.current === 0 && !r.previous) continue;
    const change =
      r.pctChange != null ? ` (${r.pctChange > 0 ? '+' : ''}${r.pctChange}% vs previous ${DIGEST_DAYS} days)`
        : r.previous === 0 && r.current > 0 ? ` (up from 0)`
          : '';
    lines.push(`• ${r.label}: ${r.current}${change}`);
  }
  if (!d.previousMeasured) lines.push('', 'First full period measured — next update will compare with this one.');
  lines.push('', 'Measured by Google for your Business Profile.', `Details: ${link}`);
  return lines.join('\n');
}
