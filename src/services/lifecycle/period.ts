/**
 * Lifecycle kind + idempotency period for an audit start (pure — runs under `node --test`).
 * The (businessId, auditKind, period) unique index on Audit enforces one
 * connected baseline per business and one monthly report per calendar month.
 */

/** Calendar month key in IST (the product's business timezone), e.g. "2026-09". */
export function monthKey(d = new Date()): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Lifecycle kind + idempotency period for an audit start. */
export function lifecycleOf(fastMode: boolean, trigger?: string, now = new Date()): { auditKind: 'free_report' | 'connected_baseline' | 'monthly' | 'dashboard'; period?: string } {
  if (fastMode) return { auditKind: 'free_report' };
  if (trigger === 'audit-autopilot-first-run') return { auditKind: 'connected_baseline', period: 'baseline' };
  if (trigger === 'audit-autopilot-monthly') return { auditKind: 'monthly', period: monthKey(now) };
  return { auditKind: 'dashboard' };
}
