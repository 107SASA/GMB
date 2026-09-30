/**
 * Cost model for one audit, from list prices verified Sep 2026:
 *   Google Maps Platform  developers.google.com/maps/billing-and-pricing/pricing
 *   DataForSEO            dataforseo.com/pricing (Maps SERP Live, Google Ads Search Volume Live)
 *   SerpApi               serpapi.com/pricing (Developer plan: $75 / 5,000 searches)
 *   Groq gpt-oss-120b     console.groq.com/docs/model/openai/gpt-oss-120b
 * Google's free monthly allowances are per SKU; `volumeCost` applies them.
 * Discounts above 100k requests/month are ignored, so large volumes are an
 * upper bound. Groq token counts are estimates until read from AIUsageLog.
 *
 * Pure: no I/O (runs under `node --test`).
 */

export interface UnitPrice {
  /** USD per single request/task/token-unit. */
  usd: number;
  /** Free units per month (Google only). */
  freePerMonth?: number;
}

export const UNIT_PRICES = {
  googleAutocompleteRequest: { usd: 2.83 / 1000, freePerMonth: 10_000 },
  googleDetailsLegacy: { usd: 17 / 1000, freePerMonth: 5_000 },
  googleContactData: { usd: 3 / 1000, freePerMonth: 1_000 },
  googleAtmosphereData: { usd: 5 / 1000, freePerMonth: 1_000 },
  googleDetailsNewPro: { usd: 17 / 1000, freePerMonth: 5_000 },
  googleTextSearch: { usd: 32 / 1000, freePerMonth: 5_000 },
  googleGeocoding: { usd: 5 / 1000, freePerMonth: 10_000 },
  googleStaticMap: { usd: 2 / 1000, freePerMonth: 10_000 },
  dataForSeoMapsLiveTask: { usd: 0.002 },
  dataForSeoAdsVolumeLiveTask: { usd: 0.09 },
  serpApiSearch: { usd: 75 / 5000 },
  groqInputToken: { usd: 0.15 / 1_000_000 },
  groqOutputToken: { usd: 0.6 / 1_000_000 },
  // Gemini 2.5 Flash Image list price ≈ $0.039 per image (1290 output tokens × $30/M).
  imageGeneration: { usd: 0.039 },
  // Place Details (New) with only the `location` field = Essentials SKU.
  googleDetailsNewEssentials: { usd: 5 / 1000, freePerMonth: 10_000 },
} satisfies Record<string, UnitPrice>;

export type CostItem = keyof typeof UNIT_PRICES;
export type CallProfile = Partial<Record<CostItem, number>>;

/** Average calls per audit (cache miss) — traced from the code, see the Sep 2026 audit write-up. */
export const CALL_PROFILES: Record<string, CallProfile> = {
  freeBefore: {
    googleAutocompleteRequest: 6,
    googleDetailsLegacy: 1, googleContactData: 1, googleAtmosphereData: 1,
    googleDetailsNewPro: 1,
    googleTextSearch: 3,
    googleGeocoding: 8,
    googleStaticMap: 1,
    dataForSeoMapsLiveTask: 19,
    dataForSeoAdsVolumeLiveTask: 1,
    groqInputToken: 5_000, groqOutputToken: 13_000,
  },
  freeAfter: {
    googleAutocompleteRequest: 0, // session tokens
    googleDetailsLegacy: 1, googleContactData: 1, googleAtmosphereData: 1,
    googleDetailsNewPro: 1,
    googleTextSearch: 0.6, // fallback only: ~20% of reports × 3 queries (assumption)
    googleGeocoding: 5.6, // ~30% LocalityCache hit rate (assumption, rises over time)
    googleStaticMap: 1,
    dataForSeoMapsLiveTask: 18, // grid phrase no longer re-checked by the snapshot
    dataForSeoAdsVolumeLiveTask: 1,
    groqInputToken: 5_500, groqOutputToken: 9_000, // reasoning_effort low (estimate)
  },
  dashboardBefore: {
    googleTextSearch: 3,
    dataForSeoMapsLiveTask: 45,
    dataForSeoAdsVolumeLiveTask: 1,
    serpApiSearch: 6, // resolve + ~4 pages + duplicate in-job sync
    groqInputToken: 6_000, groqOutputToken: 16_000,
  },
  dashboardAfter: {
    googleTextSearch: 0.6,
    dataForSeoMapsLiveTask: 45,
    dataForSeoAdsVolumeLiveTask: 1,
    serpApiSearch: 5,
    groqInputToken: 6_500, groqOutputToken: 11_000,
  },
  monthlyBefore: {
    googleTextSearch: 3,
    dataForSeoMapsLiveTask: 45,
    dataForSeoAdsVolumeLiveTask: 0.33, // 45-day keyword cache vs 30-day cadence
    serpApiSearch: 1,
    groqInputToken: 6_000, groqOutputToken: 16_000,
  },
  // Observed 28 Sep 2026 (auditData.providerUsage, live Mulsetu + Desun runs,
  // cold caches) plus the intake calls made outside the audit meter.
  freeObserved: {
    googleDetailsLegacy: 1, googleContactData: 1, googleAtmosphereData: 1,
    googleDetailsNewPro: 1,
    googleGeocoding: 8.5,
    googleStaticMap: 1,
    dataForSeoMapsLiveTask: 14.5,
    dataForSeoAdsVolumeLiveTask: 1,
    groqInputToken: 7_530, groqOutputToken: 4_140,
  },
  dashboardObserved: {
    dataForSeoMapsLiveTask: 45,
    dataForSeoAdsVolumeLiveTask: 1,
    serpApiSearch: 5,
    groqInputToken: 6_750, groqOutputToken: 3_930,
  },
  monthlyAfter: {
    googleTextSearch: 0.6,
    dataForSeoMapsLiveTask: 45,
    dataForSeoAdsVolumeLiveTask: 0.33,
    serpApiSearch: 1,
    groqInputToken: 6_500, groqOutputToken: 11_000,
  },
};

/** USD for one audit at list price (free allowances ignored). */
export function auditCostUsd(profile: CallProfile): number {
  let total = 0;
  for (const [item, count] of Object.entries(profile) as Array<[CostItem, number]>) {
    total += (count || 0) * UNIT_PRICES[item].usd;
  }
  return Math.round(total * 10_000) / 10_000;
}

/** USD for `n` audits in one month, with Google's per-SKU free allowances applied. */
export function volumeCostUsd(profile: CallProfile, n: number): number {
  let total = 0;
  for (const [item, count] of Object.entries(profile) as Array<[CostItem, number]>) {
    const price: UnitPrice = UNIT_PRICES[item];
    const units = (count || 0) * n;
    const billable = Math.max(0, units - (price.freePerMonth ?? 0));
    total += billable * price.usd;
  }
  return Math.round(total * 100) / 100;
}

export function toInr(usd: number, inrPerUsd = 88): number {
  return Math.round(usd * inrPerUsd * 10) / 10;
}
