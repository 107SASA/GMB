/**
 * Growth Partner commissions — pure rules, so tests load them directly.
 *
 * One commission per captured customer payment (one per company invoice):
 *  - "first"     — the workspace's first ever payment → partner's first-payment %
 *  - "recurring" — every later payment → partner's recurring %, optionally only
 *                  for `recurringMonths` after the first payment
 * The rate is the one in force on the PAYMENT date (from the partner's terms
 * history), so changing a partner's terms never rewrites earlier payments.
 * Base = amount received excluding GST. A commission can be paid out
 * `holdDays` after the payment (refund window), once an admin approves it.
 */

export interface TermsSnapshot {
  firstPaymentRate: number;
  recurringRate: number;
  holdDays: number;
  recurringMonths?: number | null;
  changedAt?: Date | string;
}

/** The partner's terms as they were at `at` — the latest history entry on or before it, else the oldest known. */
export function termsAt(history: TermsSnapshot[] | null | undefined, current: TermsSnapshot, at: Date): TermsSnapshot {
  const entries = (history ?? [])
    .filter((h) => h && h.changedAt)
    .sort((a, b) => new Date(a.changedAt!).getTime() - new Date(b.changedAt!).getTime());
  if (!entries.length) return current;
  let pick: TermsSnapshot | null = null;
  for (const h of entries) if (new Date(h.changedAt!).getTime() <= at.getTime()) pick = h;
  return pick ?? entries[0];
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Amount excluding GST, never negative. */
export function commissionBase(amount: number, taxAmount: number | null | undefined): number {
  return round2(Math.max(0, (Number(amount) || 0) - (Number(taxAmount) || 0)));
}

export function commissionAmount(base: number, ratePercent: number): number {
  return round2((base * ratePercent) / 100);
}

/** Recurring commission applies within `months` of the first payment (no limit when months is empty). */
export function withinRecurringWindow(firstPaidAt: Date | null, paidAt: Date, months: number | null | undefined): boolean {
  if (!months || !firstPaidAt) return true;
  const end = new Date(firstPaidAt);
  end.setMonth(end.getMonth() + months);
  return paidAt.getTime() <= end.getTime();
}

export function availableAt(paidAt: Date, holdDays: number): Date {
  return new Date(paidAt.getTime() + Math.max(0, holdDays) * 86_400_000);
}

export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'reversed';

/** What the commission looks like to people: on hold (in the refund window), ready to approve, etc. */
export function commissionStage(c: { status: CommissionStatus; availableAt: Date | string }, now = new Date()):
  'on_hold' | 'ready' | 'approved' | 'paid' | 'reversed' {
  if (c.status === 'pending') return new Date(c.availableAt).getTime() > now.getTime() ? 'on_hold' : 'ready';
  return c.status;
}

export const COMMISSION_STAGE_LABEL: Record<ReturnType<typeof commissionStage>, string> = {
  on_hold: 'On hold',
  ready: 'Ready for approval',
  approved: 'Approved — awaiting payout',
  paid: 'Paid',
  reversed: 'Reversed',
};

/** Payout totals. TDS isn't decided yet, so it defaults to 0 but is supported. */
export function payoutTotals(amounts: number[], tdsPercent: number | null | undefined) {
  const gross = round2(amounts.reduce((s, a) => s + a, 0));
  const pct = tdsPercent && tdsPercent > 0 ? Math.min(tdsPercent, 100) : 0;
  const tds = round2((gross * pct) / 100);
  return { gross, tdsPercent: pct, tds, net: round2(gross - tds) };
}
