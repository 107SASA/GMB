import { checkDurableRateLimit } from '@/lib/durableRateLimit';

/**
 * DataForSEO allows 12 Google Ads "live" requests per minute for the whole
 * account (search volume, keyword ideas and keywords-for-site share the
 * limit — checked via appendix/user_data, Nov 2026). One full audit makes
 * ~6–8, so two audits at once would get requests refused and lose keywords.
 *
 * Every Google Ads request waits here for a slot instead. The count lives in
 * MongoDB (lib/durableRateLimit.ts), so it holds across PM2 processes. If
 * the database is down the check fails open; after `maxWaitMs` the request
 * goes ahead anyway — at worst it is refused and the caller's existing
 * "no data" path runs, exactly as before this gate.
 */

const WINDOW_MS = 60_000;

function perMinute(): number {
  const n = Number(process.env.DATAFORSEO_ADS_PER_MINUTE);
  return Number.isFinite(n) && n > 0 ? n : 11; // one below the account limit, for safety
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForGoogleAdsSlot(reason: string, maxWaitMs = 180_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    const { allowed } = await checkDurableRateLimit('dataforseo:google_ads_live', perMinute(), WINDOW_MS);
    if (allowed) return;
    const waited = Date.now() - started;
    if (waited >= maxWaitMs) {
      console.warn(`[googleAdsRateGate] ${reason}: no slot after ${Math.round(waited / 1000)}s — sending anyway`);
      return;
    }
    // Next window starts at the next minute boundary; small jitter spreads waiting callers.
    const untilNextWindow = WINDOW_MS - (Date.now() % WINDOW_MS);
    await sleep(Math.min(untilNextWindow + Math.floor(Math.random() * 1500), maxWaitMs - waited));
  }
}
