/**
 * READ-ONLY inventory of billing records saved before the Razorpay test/live
 * mode was recorded (see razorpayMode.ts). Pure (no imports): it is handed a
 * MongoDB `Db` and only ever sees it through readOnlyDb(), which throws on any
 * method that is not a read — so it cannot update, delete or release anything.
 *
 * Output: counts and identifiers only (Mongo ObjectIds, Razorpay plan_/sub_
 * ids, statuses, dates). No names, phones, emails, phone hashes or secrets.
 *
 * A record listed here is NOT proven test-mode. Proof comes only from
 * verifyTestModeSubscriptions() run with TEST keys (a successful test-mode
 * lookup); a failed lookup proves nothing.
 */

const READ_METHODS = new Set(['find', 'findOne', 'countDocuments', 'aggregate', 'distinct']);

/** A Db whose collections expose read methods only — any write method throws before reaching MongoDB. */
export function readOnlyDb(db: any): { databaseName: string; collection: (name: string) => any } {
  return {
    databaseName: String(db?.databaseName ?? ''),
    collection(name: string) {
      const coll = db.collection(name);
      return new Proxy(coll, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== 'function') return value;
          if (typeof prop === 'string' && READ_METHODS.has(prop)) return value.bind(target);
          throw new Error(`legacy inventory is read-only: "${String(prop)}" is not allowed`);
        },
      });
    },
  };
}

const ACCESS_STATUSES = new Set(['active', 'trial_active', 'past_due']);
const id = (v: unknown) => (v == null ? null : String(v));
const present = { $exists: true, $nin: [null, ''] };

export interface LegacyInventory {
  database: string;
  generatedAt: string;
  notes: string[];
  counts: Record<string, number>;
  billingPlan: {
    /** Stored plan ids with no recorded mode — ignored under live keys already; listed for completeness. */
    plansWithoutMode: Array<{ where: 'duration' | 'legacy_top_level'; cycle: string | null; razorpayPlanId: string; razorpayPlanPriceInr: number | null }>;
  };
  workspaces: {
    /** Not paying; latest checkout link has no recorded mode → a live checkout for them is refused (503) until proven. */
    unfinishedCheckouts: Array<{ businessId: string; subscriptionStatus: string | null; razorpaySubscriptionId: string }>;
    /** Has access through a subscription whose mode is never recorded (test-era paid / trial / past-due). Human decision. */
    withAccess: Array<{
      businessId: string;
      userId: string | null;
      subscriptionStatus: string;
      billingSubscriptionId: string | null;
      checkoutLinkId: string | null;
      checkoutLinkModeRecorded: boolean;
      recoveryCheckoutSubscriptionId: string | null;
      trialEndsAt: string | null;
      subscriptionCurrentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
    }>;
    /** Not paying; the link is the ended paying subscription — does not block checkout. */
    endedPayingLinks: Array<{ businessId: string; subscriptionStatus: string | null; razorpaySubscriptionId: string }>;
  };
  trialClaims: Array<{ claimId: string; status: string; businessId: string | null; holderBusinessId: string | null; razorpaySubscriptionId: string; needsReview: boolean; hasOffer: boolean }>;
  subscriptions: Array<{ userId: string | null; planType: string | null; billingStatus: string | null; razorpaySubscriptionId: string }>;
}

export async function collectLegacyBillingInventory(rawDb: any, now: Date = new Date()): Promise<LegacyInventory> {
  const db = readOnlyDb(rawDb);

  // ── BillingPlan ──
  const plan = await db.collection('billingplans').findOne({ key: 'default' }, { projection: { durations: 1, razorpayPlanId: 1, razorpayPlanPriceInr: 1, razorpayPlanMode: 1 } });
  const plansWithoutMode: LegacyInventory['billingPlan']['plansWithoutMode'] = [];
  for (const d of plan?.durations ?? []) {
    if (d?.razorpayPlanId && !d.razorpayPlanMode) {
      plansWithoutMode.push({ where: 'duration', cycle: d.cycle ?? null, razorpayPlanId: String(d.razorpayPlanId), razorpayPlanPriceInr: d.razorpayPlanPriceInr ?? null });
    }
  }
  if (plan?.razorpayPlanId && !plan.razorpayPlanMode) {
    plansWithoutMode.push({ where: 'legacy_top_level', cycle: 'monthly', razorpayPlanId: String(plan.razorpayPlanId), razorpayPlanPriceInr: plan.razorpayPlanPriceInr ?? null });
  }

  // ── Business ──
  const businesses = await db
    .collection('businesses')
    .find(
      { $or: [{ razorpaySubscriptionId: present }, { billingSubscriptionId: present }] },
      {
        projection: {
          userId: 1, subscriptionStatus: 1, razorpaySubscriptionId: 1, razorpaySubscriptionEnv: 1, billingSubscriptionId: 1,
          recoveryCheckout: 1, trialEndsAt: 1, subscriptionCurrentPeriodEnd: 1, subscriptionCancelAtPeriodEnd: 1,
        },
      }
    )
    .toArray();
  const unfinishedCheckouts: LegacyInventory['workspaces']['unfinishedCheckouts'] = [];
  const withAccess: LegacyInventory['workspaces']['withAccess'] = [];
  const endedPayingLinks: LegacyInventory['workspaces']['endedPayingLinks'] = [];
  for (const b of businesses) {
    const link: string | null = b.razorpaySubscriptionId || null;
    const linkModeRecorded = !!link && b.razorpaySubscriptionEnv?.subscriptionId === link && ['test', 'live'].includes(b.razorpaySubscriptionEnv?.mode);
    const status: string | null = b.subscriptionStatus ?? null;
    if (status && ACCESS_STATUSES.has(status)) {
      // The paying subscription (billingSubscriptionId) never carries a mode.
      withAccess.push({
        businessId: String(b._id),
        userId: id(b.userId),
        subscriptionStatus: status,
        billingSubscriptionId: b.billingSubscriptionId || null,
        checkoutLinkId: link && link !== b.billingSubscriptionId ? link : null,
        checkoutLinkModeRecorded: linkModeRecorded,
        recoveryCheckoutSubscriptionId: b.recoveryCheckout?.subscriptionId || null,
        trialEndsAt: b.trialEndsAt ? new Date(b.trialEndsAt).toISOString() : null,
        subscriptionCurrentPeriodEnd: b.subscriptionCurrentPeriodEnd ? new Date(b.subscriptionCurrentPeriodEnd).toISOString() : null,
        cancelAtPeriodEnd: !!b.subscriptionCancelAtPeriodEnd,
      });
    } else if (link && link === b.billingSubscriptionId) {
      endedPayingLinks.push({ businessId: String(b._id), subscriptionStatus: status, razorpaySubscriptionId: link });
    } else if (link && !linkModeRecorded) {
      unfinishedCheckouts.push({ businessId: String(b._id), subscriptionStatus: status, razorpaySubscriptionId: link });
    }
  }

  // ── TrialClaim ── (phoneHash deliberately not read)
  const claims = await db
    .collection('trialclaims')
    .find(
      { razorpaySubscriptionId: present, 'offer.razorpayMode': { $exists: false } },
      { projection: { status: 1, businessId: 1, holderBusinessId: 1, razorpaySubscriptionId: 1, needsReview: 1, offer: 1 } }
    )
    .toArray();
  const trialClaims: LegacyInventory['trialClaims'] = claims.map((c: any) => ({
    claimId: String(c._id),
    status: String(c.status ?? ''),
    businessId: id(c.businessId),
    holderBusinessId: id(c.holderBusinessId),
    razorpaySubscriptionId: String(c.razorpaySubscriptionId),
    needsReview: !!c.needsReview,
    hasOffer: !!c.offer,
  }));

  // ── Subscription (user level) — never records a mode ──
  const subs = await db
    .collection('subscriptions')
    .find({ razorpaySubscriptionId: present }, { projection: { userId: 1, planType: 1, billingStatus: 1, razorpaySubscriptionId: 1 } })
    .toArray();
  const subscriptions: LegacyInventory['subscriptions'] = subs.map((s: any) => ({
    userId: id(s.userId),
    planType: s.planType ?? null,
    billingStatus: s.billingStatus ?? null,
    razorpaySubscriptionId: String(s.razorpaySubscriptionId),
  }));

  const countBy = <T,>(rows: T[], key: (r: T) => string) =>
    rows.reduce<Record<string, number>>((acc, r) => ((acc[key(r)] = (acc[key(r)] ?? 0) + 1), acc), {});

  return {
    database: db.databaseName,
    generatedAt: now.toISOString(),
    notes: [
      'Read-only: nothing was written.',
      'Listed records are NOT proven test-mode. Prove with a successful lookup using TEST keys; a failed lookup proves nothing.',
      'workspaces.withAccess always lists every paying/trial/past-due workspace: their paying subscription never records a mode.',
    ],
    counts: {
      plansWithoutMode: plansWithoutMode.length,
      unfinishedCheckouts: unfinishedCheckouts.length,
      withAccess: withAccess.length,
      ...Object.fromEntries(Object.entries(countBy(withAccess, (w) => w.subscriptionStatus)).map(([k, v]) => [`withAccess.${k}`, v])),
      endedPayingLinks: endedPayingLinks.length,
      trialClaims: trialClaims.length,
      ...Object.fromEntries(Object.entries(countBy(trialClaims, (c) => c.status)).map(([k, v]) => [`trialClaims.${k}`, v])),
      subscriptions: subscriptions.length,
    },
    billingPlan: { plansWithoutMode },
    workspaces: { unfinishedCheckouts, withAccess, endedPayingLinks },
    trialClaims,
    subscriptions,
  };
}

// ── Test-mode verification (separate step, TEST keys only) ─────────────────

export type TestModeVerdict =
  /** Found with TEST keys → it exists in Razorpay test mode (ids are unique), so it can never charge real money. */
  | 'confirmed_test'
  /** Not found with TEST keys → NOT proof of anything (could be live, another account, or a typo). Review. */
  | 'not_found_unproven'
  /** Any other failure (network, auth, rate limit) → unproven. Review / retry. */
  | 'lookup_failed_unproven';

/** Every distinct Razorpay subscription id the inventory mentions, with where it came from. */
export function subscriptionIdsFromInventory(inv: LegacyInventory): Map<string, string[]> {
  const ids = new Map<string, string[]>();
  const add = (sub: string | null, source: string) => {
    if (!sub) return;
    ids.set(sub, [...(ids.get(sub) ?? []), source]);
  };
  for (const w of inv.workspaces.unfinishedCheckouts) add(w.razorpaySubscriptionId, `business:${w.businessId}:checkout`);
  for (const w of inv.workspaces.withAccess) {
    add(w.billingSubscriptionId, `business:${w.businessId}:paying`);
    add(w.checkoutLinkId, `business:${w.businessId}:checkout`);
    add(w.recoveryCheckoutSubscriptionId, `business:${w.businessId}:recovery`);
  }
  for (const c of inv.trialClaims) add(c.razorpaySubscriptionId, `trialClaim:${c.claimId}`);
  for (const s of inv.subscriptions) add(s.razorpaySubscriptionId, `subscription:user:${s.userId}`);
  return ids;
}

function isNotFound(err: any): boolean {
  const description = String(err?.error?.description ?? err?.message ?? '');
  return /does not exist/i.test(description);
}

/**
 * Looks each id up with TEST keys (read-only GET). Refuses unless the key id is
 * a test key. `fetchSubscription` is the Razorpay SDK's subscriptions.fetch
 * bound to a TEST-key client (tests pass a fake).
 */
export async function verifyTestModeSubscriptions(
  ids: Map<string, string[]>,
  input: { keyId: string | undefined; fetchSubscription: (id: string) => Promise<any>; delayMs?: number }
): Promise<Array<{ razorpaySubscriptionId: string; sources: string[]; verdict: TestModeVerdict; testStatus: string | null; testPaidCount: number | null }>> {
  if (!String(input.keyId ?? '').startsWith('rzp_test_')) {
    throw new Error('Refusing to verify: RAZORPAY_KEY_ID must be a TEST key (rzp_test_…). Live keys are never used here.');
  }
  const out = [];
  for (const [sub, sources] of ids) {
    try {
      const s = await input.fetchSubscription(sub);
      out.push({ razorpaySubscriptionId: sub, sources, verdict: 'confirmed_test' as const, testStatus: String(s?.status ?? ''), testPaidCount: Number(s?.paid_count ?? 0) });
    } catch (err: any) {
      out.push({ razorpaySubscriptionId: sub, sources, verdict: isNotFound(err) ? ('not_found_unproven' as const) : ('lookup_failed_unproven' as const), testStatus: null, testPaidCount: null });
    }
    if (input.delayMs) await new Promise((r) => setTimeout(r, input.delayMs));
  }
  return out;
}
