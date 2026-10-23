import dbConnect from '@/lib/mongodb';
import BillingPlan from '@/models/BillingPlan';
import { getRazorpay, getRazorpayMode } from './razorpay';
import { isPlanIdUsable, type RazorpayMode } from './razorpayMode';
import type { ModuleKey } from '@/models/Subscription';

/**
 * THE single source of truth for the one sellable plan. There is exactly one
 * paid plan — it unlocks every module (website + mobile app). The super admin
 * edits its price/name/copy via /api/admin/billing-plan, which is stored in
 * the BillingPlan singleton; everything here falls back to PLAN_FALLBACK
 * until that document exists.
 *
 * Internally the paid plan keeps the legacy planType 'Pro' so the
 * Subscription enum, User.subscriptionPlan gating (featureGating.ts /
 * PlanConfig) and the mobile app contract stay unchanged. 'Enterprise' is a
 * legacy value that may still exist on old subscriptions/webhooks — it is
 * treated as paid but can no longer be purchased.
 */

export type SellablePlanType = 'Pro';
export const PAID_PLAN_TYPE: SellablePlanType = 'Pro';

/** Paid plan types we may still see on old subscriptions/webhook notes. */
export function isPaidPlanType(planType: unknown): boolean {
  return planType === 'Pro' || planType === 'Enterprise';
}

export const ALL_MODULES: ModuleKey[] = [
  'google_ranking_agent',
  'reputation_agent',
  'sales_agent',
  'content_studio',
  'marketing_automation',
];

// ── Billing durations ──────────────────────────────────────────────────────
export type BillingCycle = 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

export interface CycleMeta {
  label: string;
  months: number;
  razorpayPeriod: 'monthly' | 'yearly';
  razorpayInterval: number;
  /** How many billing cycles Razorpay attempts before the subscription ends. */
  totalCount: number;
}

export const CYCLES: Record<BillingCycle, CycleMeta> = {
  monthly:    { label: 'Monthly',   months: 1,  razorpayPeriod: 'monthly', razorpayInterval: 1, totalCount: 12 },
  quarterly:  { label: 'Quarterly', months: 3,  razorpayPeriod: 'monthly', razorpayInterval: 3, totalCount: 8 },
  halfyearly: { label: '6 Months',  months: 6,  razorpayPeriod: 'monthly', razorpayInterval: 6, totalCount: 6 },
  yearly:     { label: 'Yearly',    months: 12, razorpayPeriod: 'yearly',  razorpayInterval: 1, totalCount: 5 },
};

export const CYCLE_ORDER: BillingCycle[] = ['monthly', 'quarterly', 'halfyearly', 'yearly'];

export function isBillingCycle(v: unknown): v is BillingCycle {
  return typeof v === 'string' && (CYCLE_ORDER as string[]).includes(v);
}

export const DEFAULT_FEATURES: string[] = [
  'Google Ranking Agent — GBP optimization & audits',
  'Reputation Agent — reviews & AI replies',
  'Content Studio — AI posts & SEO content',
  'Marketing Automation — campaigns & CRM',
  'Full access on web and mobile app',
];

/**
 * Modules that stay enabled with no paid plan — matches the Subscription
 * schema defaults (google_ranking_agent defaults to enabled, all others to
 * disabled). Applied on cancel/expiry.
 */
export const DEFAULT_FREE_MODULES: ModuleKey[] = ['google_ranking_agent'];

/** Defaults used until the super admin saves the BillingPlan document. */
export const PLAN_FALLBACK = {
  displayName: 'GrowwMatics AI',
  description:
    'One plan, everything included — GBP optimization, reviews, AI sales agent, content and marketing automation, on web and mobile.',
  priceInr: 1999,
} as const;

export interface PlanDurationView {
  cycle: BillingCycle;
  label: string;
  months: number;
  priceInr: number;
  enabled: boolean;
  /** Razorpay Plan id valid for this cycle's CURRENT price, or null. */
  razorpayPlanId: string | null;
}

export interface ActivePlan {
  planType: SellablePlanType;
  displayName: string;
  description: string;
  features: string[];
  /** Monthly price (back-compat convenience). */
  priceInr: number;
  billingCycle: 'monthly';
  modules: ModuleKey[];
  /** All four durations, with per-cycle price/enabled/razorpay id. */
  durations: PlanDurationView[];
  /** Monthly Razorpay Plan id valid for the current monthly price, or null. */
  razorpayPlanId: string | null;
}

/**
 * The Razorpay plan fields saved for `cycle` that are valid for `priceInr`,
 * exactly as stored (id, price, mode) — from the stored duration, or for
 * monthly without one, the legacy top-level fields. Null when none apply.
 * Admin saves carry these over for an unchanged price.
 */
export function storedPlanFieldsForPrice(
  doc: any,
  cycle: BillingCycle,
  priceInr: number
): { razorpayPlanId: string; razorpayPlanPriceInr: number; razorpayPlanMode?: RazorpayMode } | null {
  const stored = (doc?.durations ?? []).find((d: any) => d.cycle === cycle);
  const src = stored ?? (cycle === 'monthly' ? doc : null);
  if (!src?.razorpayPlanId || src.razorpayPlanPriceInr !== priceInr) return null;
  return {
    razorpayPlanId: src.razorpayPlanId,
    razorpayPlanPriceInr: src.razorpayPlanPriceInr,
    ...(src.razorpayPlanMode && { razorpayPlanMode: src.razorpayPlanMode }),
  };
}

/** A stored duration for `cycle` synthesized from the legacy fields (monthly) or defaults (others: disabled, base × months). */
function synthesizedDuration(doc: any, cycle: BillingCycle) {
  const base = doc?.priceInr ?? PLAN_FALLBACK.priceInr;
  if (cycle === 'monthly') return { cycle, priceInr: base, enabled: true, ...storedPlanFieldsForPrice(doc, cycle, base) };
  return { cycle, priceInr: base * CYCLES[cycle].months, enabled: false };
}

/**
 * RAZORPAY_PLAN_ID_PRO (only used before the super admin ever saves the plan)
 * has no recorded price or mode — like a legacy id, it is test-only.
 */
function envFallbackPlanId(mode: RazorpayMode | null): string | null {
  return mode === 'test' ? process.env.RAZORPAY_PLAN_ID_PRO || null : null;
}

/** Builds the four duration views, preferring stored durations, else synthesizing. */
function buildDurations(doc: any, base: number, mode: RazorpayMode | null): PlanDurationView[] {
  const stored = new Map<string, any>((doc?.durations ?? []).map((d: any) => [d.cycle, d]));
  return CYCLE_ORDER.map((cycle) => {
    const meta = CYCLES[cycle];
    const s = stored.get(cycle);
    if (s) {
      // A stored Razorpay id is only usable if created for the current price, in the current mode.
      const usable = isPlanIdUsable(
        { planId: s.razorpayPlanId, planPriceInr: s.razorpayPlanPriceInr, planMode: s.razorpayPlanMode },
        { priceInr: s.priceInr, mode }
      );
      return { cycle, label: meta.label, months: meta.months, priceInr: s.priceInr, enabled: !!s.enabled, razorpayPlanId: usable ? s.razorpayPlanId : null };
    }
    // No stored duration: monthly falls back to the legacy fields; others are
    // disabled at a sensible default (base × months) until the admin sets them.
    if (cycle === 'monthly') {
      const rp = doc
        ? (isPlanIdUsable({ planId: doc.razorpayPlanId, planPriceInr: doc.razorpayPlanPriceInr, planMode: doc.razorpayPlanMode }, { priceInr: base, mode })
            ? doc.razorpayPlanId
            : null)
        : envFallbackPlanId(mode);
      return { cycle, label: meta.label, months: 1, priceInr: base, enabled: true, razorpayPlanId: rp };
    }
    return { cycle, label: meta.label, months: meta.months, priceInr: base * meta.months, enabled: false, razorpayPlanId: null };
  });
}

function toActivePlan(doc: any, mode: RazorpayMode | null): ActivePlan {
  const priceInr = doc?.priceInr ?? PLAN_FALLBACK.priceInr;
  const durations = buildDurations(doc, priceInr, mode);
  const monthly = durations.find((d) => d.cycle === 'monthly')!;

  return {
    planType: PAID_PLAN_TYPE,
    displayName: doc?.displayName ?? PLAN_FALLBACK.displayName,
    description: doc?.description ?? PLAN_FALLBACK.description,
    features: doc?.features?.length ? doc.features : DEFAULT_FEATURES,
    priceInr,
    billingCycle: 'monthly',
    modules: ALL_MODULES,
    durations,
    razorpayPlanId: monthly.razorpayPlanId,
  };
}

/** The one sellable plan, with super-admin overrides applied; Razorpay ids only when valid for the current keys' mode. */
export async function getActivePlan(): Promise<ActivePlan> {
  await dbConnect();
  const doc = await BillingPlan.findOne({ key: 'default' }).lean();
  return toActivePlan(doc, getRazorpayMode());
}

/** Thrown when the duration's price/availability changed while its Razorpay plan was being created. */
export class BillingPlanChangedError extends Error {
  readonly code = 'PLAN_CHANGED';
  constructor() {
    super('The price for this billing duration was just updated. Please refresh the page and try again.');
  }
}

export interface RazorpayPlanCreateParams {
  period: 'monthly' | 'yearly';
  interval: number;
  item: { name: string; amount: number; currency: 'INR'; description?: string };
}

export interface EnsurePlanDeps {
  /** Creates a Razorpay plan (tests pass a fake; default: the configured Razorpay client). */
  createPlan?: (params: RazorpayPlanCreateParams) => Promise<{ id: string }>;
}

/**
 * Makes sure the stored durations have a slot for `cycle`, without ever
 * overwriting what the super admin saved: each write is conditional on the
 * document, the array, or the slot still being absent.
 */
async function ensureDurationSlot(cycle: BillingCycle): Promise<void> {
  const doc = await BillingPlan.findOne({ key: 'default' }).lean<any>();
  if (!doc) {
    const fallback = toActivePlan(null, null);
    try {
      await BillingPlan.updateOne(
        { key: 'default' },
        {
          $setOnInsert: {
            displayName: fallback.displayName,
            description: fallback.description,
            priceInr: fallback.priceInr,
            features: fallback.features,
            durations: CYCLE_ORDER.map((c) => synthesizedDuration(null, c)),
            revision: 1,
          },
        },
        { upsert: true }
      );
    } catch (err: any) {
      if (err?.code !== 11000) throw err; // created concurrently — keep theirs
    }
    return;
  }
  const stored: any[] = doc.durations ?? [];
  if (stored.length === 0) {
    await BillingPlan.updateOne(
      { key: 'default', $or: [{ durations: { $exists: false } }, { durations: { $size: 0 } }] },
      { $set: { durations: CYCLE_ORDER.map((c) => synthesizedDuration(doc, c)) }, $inc: { revision: 1 } }
    );
  } else if (!stored.some((d) => d.cycle === cycle)) {
    await BillingPlan.updateOne(
      { key: 'default', 'durations.cycle': { $ne: cycle } },
      { $push: { durations: synthesizedDuration(doc, cycle) }, $inc: { revision: 1 } }
    );
  }
}

/**
 * Ensures the given duration has a Razorpay plan id matching its current price
 * in the current Razorpay mode, creating one via the Razorpay API when needed.
 * Only that duration's id/price/mode is written, and only while its stored
 * price is still the one the plan was created for: a concurrent admin price
 * change is never overwritten and never gets the stale plan (this request
 * fails with BillingPlanChangedError instead; the unattached plan stays unused).
 * Returns razorpayPlanId: null when Razorpay isn't configured (caller answers 503).
 */
export async function ensureRazorpayPlanIdForCycle(cycle: BillingCycle, deps: EnsurePlanDeps = {}): Promise<PlanDurationView> {
  const plan = await getActivePlan();
  const dur = plan.durations.find((d) => d.cycle === cycle);
  if (!dur) throw new Error(`Unknown billing cycle: ${cycle}`);
  if (!dur.enabled) throw new Error('That billing duration is not available.');
  if (dur.razorpayPlanId) return dur;

  const mode = getRazorpayMode();
  let createPlan = deps.createPlan;
  if (!createPlan) {
    const razorpay = getRazorpay();
    if (razorpay) createPlan = (params) => razorpay.plans.create(params) as Promise<{ id: string }>;
  }
  if (!mode || !createPlan) return dur; // caller answers 503

  await ensureDurationSlot(cycle);

  const meta = CYCLES[cycle];
  const rpPlan = await createPlan({
    period: meta.razorpayPeriod,
    interval: meta.razorpayInterval,
    item: {
      name: `${plan.displayName} (${meta.label})`,
      amount: dur.priceInr * 100, // paise
      currency: 'INR',
      description: plan.description || undefined,
    },
  });

  const attached = await BillingPlan.updateOne(
    { key: 'default', durations: { $elemMatch: { cycle, priceInr: dur.priceInr, enabled: true } } },
    {
      $set: {
        'durations.$.razorpayPlanId': rpPlan.id,
        'durations.$.razorpayPlanPriceInr': dur.priceInr,
        'durations.$.razorpayPlanMode': mode,
      },
      $inc: { revision: 1 },
    }
  );
  if (attached.matchedCount === 0) {
    console.warn(`[billing] ${cycle} price or availability changed while Razorpay plan ${rpPlan.id} was being created — not attached`);
    throw new BillingPlanChangedError();
  }

  return { ...dur, razorpayPlanId: rpPlan.id };
}

export interface AdminDurationInput {
  cycle: BillingCycle;
  priceInr: number;
  enabled: boolean;
}

/** Matches the document only while it is still at the revision that was read. */
function revisionFilter(doc: any): Record<string, unknown> {
  return Number.isInteger(doc?.revision) ? { revision: doc.revision } : { revision: { $exists: false } };
}

const ADMIN_SAVE_ATTEMPTS = 3;

/**
 * The super admin's plan save. Applies the admin's fields as sent and, per
 * duration, carries over the stored Razorpay plan (id, price, mode) only for
 * an unchanged price. Compare-and-set on `revision`: if a checkout attached a
 * plan id (or another save landed) after this save read the document, it
 * re-reads and re-merges instead of overwriting it, so both the admin's
 * changes and saved plan ids survive. 'conflict' after repeated collisions.
 * `hooks.afterRead` exists for tests to interleave a concurrent write.
 */
export async function saveAdminPlan(
  input: { fields: Record<string, unknown>; durations?: AdminDurationInput[] },
  hooks: { afterRead?: () => Promise<void> } = {}
): Promise<'saved' | 'conflict'> {
  await dbConnect();
  for (let attempt = 0; attempt < ADMIN_SAVE_ATTEMPTS; attempt++) {
    const doc = await BillingPlan.findOne({ key: 'default' }).lean<any>();
    const view = toActivePlan(doc, null);
    // Required fields filled from the fresh document on every attempt (first save included).
    const set: Record<string, unknown> = {
      displayName: view.displayName,
      description: view.description,
      priceInr: view.priceInr,
      ...input.fields,
    };
    if (input.durations) {
      const seen = new Set(input.durations.map((d) => d.cycle));
      set.durations = [
        ...input.durations.map((d) => ({ ...d, ...storedPlanFieldsForPrice(doc, d.cycle, d.priceInr) })),
        // Every cycle keeps a slot (disabled if omitted).
        ...CYCLE_ORDER.filter((c) => !seen.has(c)).map((c) => ({
          cycle: c,
          priceInr: view.durations.find((v) => v.cycle === c)!.priceInr,
          enabled: false,
        })),
      ];
      // Keep the legacy monthly price in sync for back-compat readers.
      const monthly = input.durations.find((d) => d.cycle === 'monthly');
      if (monthly) set.priceInr = monthly.priceInr;
    }
    await hooks.afterRead?.();

    if (!doc) {
      try {
        await BillingPlan.create({ key: 'default', ...set, revision: 1 });
        return 'saved';
      } catch (err: any) {
        if (err?.code === 11000) continue; // created concurrently — merge with it
        throw err;
      }
    }
    const res = await BillingPlan.updateOne(
      { key: 'default', ...revisionFilter(doc) },
      { $set: set, $inc: { revision: 1 } },
      { runValidators: true }
    );
    if (res.matchedCount > 0) return 'saved';
  }
  return 'conflict';
}

/** Back-compat: ensures the MONTHLY duration's Razorpay plan id. */
export async function ensureRazorpayPlanId(): Promise<ActivePlan> {
  await ensureRazorpayPlanIdForCycle('monthly').catch(() => undefined);
  return getActivePlan();
}

/**
 * Builds the full Subscription.modules map for a set of enabled modules:
 * listed modules on (stamped now), everything else off.
 */
export function buildModulesMap(
  enabled: ModuleKey[]
): Record<ModuleKey, { enabled: boolean; activatedAt: Date | null }> {
  const now = new Date();
  return Object.fromEntries(
    ALL_MODULES.map((key) => [
      key,
      enabled.includes(key) ? { enabled: true, activatedAt: now } : { enabled: false, activatedAt: null },
    ])
  ) as Record<ModuleKey, { enabled: boolean; activatedAt: Date | null }>;
}

/** Plan shape safe to return from the public /api/billing/plans route. */
export async function publicCatalog() {
  const plan = await getActivePlan();
  return {
    planType: plan.planType,
    displayName: plan.displayName,
    description: plan.description,
    priceInr: plan.priceInr,
    billingCycle: plan.billingCycle,
    modules: plan.modules,
    features: plan.features,
    // Only the enabled durations are offered to customers.
    durations: plan.durations
      .filter((d) => d.enabled)
      .map((d) => ({ cycle: d.cycle, label: d.label, months: d.months, priceInr: d.priceInr })),
    available: Boolean(getRazorpayMode()),
  };
}
