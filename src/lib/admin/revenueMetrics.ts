/**
 * Platform revenue metrics — pure, so tests load it directly. The single
 * definition behind /admin (Overview), /admin/revenue and the revenue strip
 * on /admin/pipeline (services/admin/platformMetrics.ts loads the rows).
 *
 * Workspace statuses (Business.subscriptionStatus):
 *   trialing     the never-paid default every new workspace gets — NOT a trial
 *   trial_active an authorised free trial (mandate set up, not charged yet)
 *   active       paying
 *   past_due     a charge failed; may still be inside its grace period
 *   canceled     ended
 *
 * MRR counts each paying Razorpay subscription once, at the monthly
 * equivalent of what it actually pays: the recorded per-cycle amount over
 * the cycle's months. A workspace paid before the cycle was recorded falls
 * back to its last charged amount matched against the plan's cycle prices,
 * and only then to the monthly plan price (counted as `estimated`).
 */

export type BillingCycle = 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

export const CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 };

export const isCycle = (v: unknown): v is BillingCycle => typeof v === 'string' && v in CYCLE_MONTHS;

export interface PayingWorkspace {
  id: string;
  billingSubscriptionId?: string | null;
  billingCycle?: string | null;
  billingAmountInr?: number | null;
  /** Last verified charge amount (INR) from the billing audit trail, for workspaces paid before cycle recording. */
  lastChargeInr?: number | null;
}

export interface PlanPrices {
  /** Per-cycle prices from the editable plan (enabled or not — an existing subscriber may be on a retired cycle). */
  byCycle: Partial<Record<BillingCycle, number>>;
  /** Fallback monthly price when nothing else is known. */
  monthlyPriceInr: number;
}

export interface MrrResult {
  mrr: number;
  arr: number;
  /** Distinct paying subscriptions counted. */
  payingSubscriptions: number;
  /** Counted at the monthly plan price because neither cycle nor amount was known. */
  estimated: number;
  byCycle: Record<BillingCycle | 'unknown', { count: number; mrr: number }>;
}

/** Cycle whose plan price equals `amountInr` (exact rupees), or null when none or more than one match. */
export function cycleForAmount(amountInr: number, prices: PlanPrices): BillingCycle | null {
  const hits = (Object.keys(prices.byCycle) as BillingCycle[]).filter((c) => prices.byCycle[c] === amountInr);
  return hits.length === 1 ? hits[0] : null;
}

/** Monthly-equivalent revenue for one paying workspace, and how it was determined. */
export function monthlyRevenueFor(w: PayingWorkspace, prices: PlanPrices): { mrr: number; cycle: BillingCycle | 'unknown'; estimated: boolean } {
  const recordedCycle = isCycle(w.billingCycle) ? w.billingCycle : null;
  const recordedAmount = typeof w.billingAmountInr === 'number' && w.billingAmountInr > 0 ? w.billingAmountInr : null;
  if (recordedCycle) {
    const amount = recordedAmount ?? prices.byCycle[recordedCycle] ?? null;
    if (amount) return { mrr: amount / CYCLE_MONTHS[recordedCycle], cycle: recordedCycle, estimated: false };
  }
  const charged = recordedAmount ?? (typeof w.lastChargeInr === 'number' && w.lastChargeInr > 0 ? w.lastChargeInr : null);
  if (charged) {
    const cycle = cycleForAmount(charged, prices);
    if (cycle) return { mrr: charged / CYCLE_MONTHS[cycle], cycle, estimated: false };
  }
  return { mrr: prices.monthlyPriceInr, cycle: 'unknown', estimated: true };
}

/** MRR/ARR over paying workspaces, each Razorpay subscription counted once. */
export function computeMrr(workspaces: PayingWorkspace[], prices: PlanPrices): MrrResult {
  const seen = new Set<string>();
  const byCycle: MrrResult['byCycle'] = {
    monthly: { count: 0, mrr: 0 },
    quarterly: { count: 0, mrr: 0 },
    halfyearly: { count: 0, mrr: 0 },
    yearly: { count: 0, mrr: 0 },
    unknown: { count: 0, mrr: 0 },
  };
  let total = 0;
  let estimated = 0;
  for (const w of workspaces) {
    const key = w.billingSubscriptionId ? `sub:${w.billingSubscriptionId}` : `ws:${w.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = monthlyRevenueFor(w, prices);
    total += r.mrr;
    byCycle[r.cycle].count += 1;
    byCycle[r.cycle].mrr += r.mrr;
    if (r.estimated) estimated += 1;
  }
  const mrr = Math.round(total);
  return { mrr, arr: mrr * 12, payingSubscriptions: seen.size, estimated, byCycle };
}

/** Plan prices from a BillingPlan document (durations[], legacy top-level priceInr). */
export function planPricesFrom(plan: any): PlanPrices {
  const byCycle: PlanPrices['byCycle'] = {};
  for (const d of plan?.durations ?? []) {
    if (isCycle(d?.cycle) && typeof d.priceInr === 'number' && d.priceInr > 0) byCycle[d.cycle as BillingCycle] = d.priceInr;
  }
  if (!byCycle.monthly && typeof plan?.priceInr === 'number' && plan.priceInr > 0) byCycle.monthly = plan.priceInr;
  const monthlyPriceInr = byCycle.monthly ?? 0;
  return { byCycle, monthlyPriceInr };
}

/** Start of the current calendar month in a timezone, as a UTC instant. */
export function startOfMonthIn(timeZone: string, now = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  // Local wall-clock "now" in that zone, read as if UTC → the zone's current offset.
  const localAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+parts.year, +parts.month - 1, 1) - offsetMs);
}

/** Human label for Business.subscriptionStatus — 'trialing' is the never-paid default, not a trial. */
export function workspaceStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'active': return 'Paying';
    case 'trial_active': return 'Free trial';
    case 'past_due': return 'Past due';
    case 'canceled': return 'Canceled';
    default: return 'Never paid';
  }
}
