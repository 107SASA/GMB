import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Counts the external provider calls actually made while an audit runs, so
 * cost reporting uses observed calls instead of estimates. processAuditJob
 * wraps its work in runWithMeter(); provider clients call meter(). Calls made
 * outside an audit (e.g. intake Places lookups) are simply not counted here.
 *
 * Units match src/services/audit/costModel.ts UNIT_PRICES keys where a price
 * exists; website fetches and cache hits are counted for visibility (free).
 * Every call also records WHY it was made, so a report's cost can be traced
 * call by call (provider → endpoint → reason → count).
 *
 * Pure (node:async_hooks only) — runs under `node --test`.
 */
export type MeterKey =
  | 'googleTextSearch'
  | 'googleGeocoding'
  | 'googleDetailsLegacy'
  | 'googleDetailsNewPro'
  | 'dataForSeoMapsLiveTask'
  | 'dataForSeoAdsVolumeLiveTask'
  | 'serpApiSearch'
  | 'groqCall'
  | 'groqInputToken'
  | 'groqOutputToken'
  | 'websiteFetch'
  | 'websiteIntelCacheHit'
  | 'geocodeCacheHit'
  | 'rankCacheHit'
  | 'narrativeCacheHit'
  | 'imageGeneration'
  | 'googleDetailsNewEssentials';

export type MeterCounts = Partial<Record<MeterKey, number>>;

/** Provider + endpoint for each metered key (cache hits are "cache"). */
export const METER_ENDPOINTS: Record<MeterKey, { provider: string; endpoint: string }> = {
  googleTextSearch: { provider: 'Google Maps Platform', endpoint: 'Places Text Search (legacy)' },
  googleGeocoding: { provider: 'Google Maps Platform', endpoint: 'Geocoding (reverse)' },
  googleDetailsLegacy: { provider: 'Google Maps Platform', endpoint: 'Place Details (legacy)' },
  googleDetailsNewPro: { provider: 'Google Maps Platform', endpoint: 'Place Details (New, Pro)' },
  dataForSeoMapsLiveTask: { provider: 'DataForSEO', endpoint: 'SERP Google Maps Live Advanced' },
  dataForSeoAdsVolumeLiveTask: { provider: 'DataForSEO', endpoint: 'Google Ads Search Volume Live' },
  serpApiSearch: { provider: 'SerpApi', endpoint: 'google_maps / google_maps_reviews' },
  groqCall: { provider: 'Groq', endpoint: 'chat.completions (gpt-oss-120b)' },
  groqInputToken: { provider: 'Groq', endpoint: 'input tokens' },
  groqOutputToken: { provider: 'Groq', endpoint: 'output tokens' },
  websiteFetch: { provider: 'Business website', endpoint: 'HTTP GET (SSRF-guarded)' },
  websiteIntelCacheHit: { provider: 'cache', endpoint: 'WebsiteIntelligence' },
  geocodeCacheHit: { provider: 'cache', endpoint: 'LocalityCache' },
  rankCacheHit: { provider: 'cache', endpoint: 'PlaceInsightCache.rank' },
  narrativeCacheHit: { provider: 'cache', endpoint: 'PlaceInsightCache.narrative' },
  imageGeneration: { provider: 'Gemini / NanoBanana', endpoint: 'image generation' },
  googleDetailsNewEssentials: { provider: 'Google Maps Platform', endpoint: 'Place Details (New, Essentials: location)' },
};

interface MeterState {
  counts: MeterCounts;
  /** `${key}|${reason}` → units */
  reasons: Record<string, number>;
}

const store = new AsyncLocalStorage<MeterState>();

export function meter(key: MeterKey, units = 1, reason = 'unspecified'): void {
  const state = store.getStore();
  if (!state || !Number.isFinite(units)) return;
  state.counts[key] = (state.counts[key] || 0) + units;
  const rk = `${key}|${reason}`;
  state.reasons[rk] = (state.reasons[rk] || 0) + units;
}

export async function runWithMeter<T>(fn: () => Promise<T>): Promise<{ result: T; counts: MeterCounts; reasons: Record<string, number> }> {
  const state: MeterState = { counts: {}, reasons: {} };
  const result = await store.run(state, fn);
  return { result, counts: state.counts, reasons: state.reasons };
}

export function currentMeter(): MeterCounts | undefined {
  return store.getStore()?.counts;
}

export function currentMeterReasons(): Record<string, number> | undefined {
  return store.getStore()?.reasons;
}

/** Add counts measured in another step (e.g. the Inngest review pre-sync). */
export function mergeIntoMeter(counts: MeterCounts | undefined, reasons: Record<string, number> | undefined): void {
  const state = store.getStore();
  if (!state) return;
  for (const [k, n] of Object.entries(counts || {})) state.counts[k as MeterKey] = (state.counts[k as MeterKey] || 0) + (n || 0);
  for (const [k, n] of Object.entries(reasons || {})) state.reasons[k] = (state.reasons[k] || 0) + (n || 0);
}

export interface ProviderCallLine {
  provider: string;
  endpoint: string;
  reason: string;
  units: number;
  listPriceUsd: number | null;
}

/** Call-by-call cost lines. `unitUsd` maps a MeterKey to its list price (costModel.UNIT_PRICES). */
export function providerCallLines(reasons: Record<string, number>, unitUsd: (key: string) => number | null): ProviderCallLine[] {
  return Object.entries(reasons)
    .map(([rk, units]) => {
      const [key, reason] = rk.split('|');
      const ep = METER_ENDPOINTS[key as MeterKey] || { provider: key, endpoint: key };
      const price = unitUsd(key);
      return { provider: ep.provider, endpoint: ep.endpoint, reason, units, listPriceUsd: price == null ? null : Math.round(price * units * 10_000) / 10_000 };
    })
    .sort((a, b) => (b.listPriceUsd ?? 0) - (a.listPriceUsd ?? 0));
}
