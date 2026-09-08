import axios from 'axios';

/**
 * Live monthly search volume from DataForSEO's Google Ads (Keyword Planner)
 * endpoint.
 *
 * The Aug 2026 bug this is written to avoid: the caller posted
 * `location_name: "Kolkata, West Bengal, India"`. Google Ads locations are
 * NOT free-text — they need a `location_code` (India = 2356) or an
 * Ads-format name like `London,England,United Kingdom`. An unrecognised
 * location silently returns an empty result, so every keyword fell through
 * to a city-tier estimate and the whole "Keyword Search Volume Analysis"
 * table rendered as `*` estimated.
 *
 * Also: credentials are read at call time (not module load) so a value set
 * in .env.local after the process started is still picked up, and the login
 * is logged masked exactly once.
 */

const SEARCH_VOLUME_URL =
  'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live';

// DataForSEO Google Ads location codes. India is the default for this
// product; the others are here so a non-IN business still resolves to a real
// country rather than an empty response.
const LOCATION_CODES: Record<string, number> = {
  india: 2356,
  'united states': 2840,
  usa: 2840,
  us: 2840,
  'united kingdom': 2826,
  uk: 2826,
  canada: 2124,
  australia: 2036,
  'united arab emirates': 2784,
  uae: 2784,
  singapore: 2702,
};
const DEFAULT_LOCATION_CODE = 2356; // India

/** Resolve a country hint (usually `business.country`, sometimes the last
 *  comma-part of an address) to a Google Ads location_code. Defaults to India. */
export function resolveGoogleAdsLocation(hint?: string): { location_code: number } {
  const raw = (hint || '').trim().toLowerCase();
  if (raw && LOCATION_CODES[raw]) return { location_code: LOCATION_CODES[raw] };
  // last comma-separated token, e.g. "MG Road, Bengaluru, Karnataka, India"
  const last = raw.split(',').map((s) => s.trim()).filter(Boolean).pop();
  if (last && LOCATION_CODES[last]) return { location_code: LOCATION_CODES[last] };
  return { location_code: DEFAULT_LOCATION_CODE };
}

let loggedLogin = false;
function creds(): { login: string; password: string } | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  if (!loggedLogin) {
    loggedLogin = true;
    const masked = login.length > 4 ? `${login.slice(0, 2)}***${login.slice(-2)}` : '***';
    console.log(`[keywordVolume] DataForSEO login ${masked}, password set (len ${password.length})`);
  }
  return { login, password };
}

export interface KeywordVolume {
  keyword: string;
  /** Live monthly volume, or null when Google Ads returned nothing for it. */
  searchVolume: number | null;
}

/**
 * Fetch search volume for a keyword list. Per-keyword results are cached for
 * ~45 days (KeywordVolumeCache) since monthly volumes barely move and the
 * DataForSEO call is a flat ~$0.09 — a live call only fires for the keywords
 * not already in the cache. Returns a Map keyed by the lowercased keyword;
 * never throws.
 */
export async function fetchSearchVolumes(
  keywords: string[],
  opts: { countryHint?: string; timeout?: number } = {},
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const unique = Array.from(
    new Set(keywords.map((k) => String(k || '').trim().toLowerCase()).filter(Boolean)),
  );
  if (unique.length === 0) return out;

  const { location_code } = resolveGoogleAdsLocation(opts.countryHint);

  // ── Cache lookup ─────────────────────────────────────────────────────────
  let KeywordVolumeCache: any = null;
  try {
    const dbConnect = (await import('@/lib/mongodb')).default;
    await dbConnect();
    KeywordVolumeCache = (await import('@/models/KeywordVolumeCache')).default;
    const keys = unique.map((kw) => `${kw}::${location_code}`);
    const cached = await KeywordVolumeCache.find({ key: { $in: keys } }).lean();
    for (const row of cached as any[]) out.set(row.keyword, row.searchVolume ?? null);
  } catch (err: any) {
    console.warn('[keywordVolume] cache read skipped:', err?.message);
  }

  const missing = unique.filter((kw) => !out.has(kw));
  if (missing.length === 0) {
    console.log(`[keywordVolume] all ${unique.length} keywords served from cache (location_code ${location_code})`);
    return out;
  }

  const c = creds();
  if (!c) {
    console.warn('[keywordVolume] DATAFORSEO_LOGIN/PASSWORD not set — skipping live volume');
    return out;
  }

  const body = [{ keywords: missing.slice(0, 700), language_code: 'en', location_code }];

  try {
    const res = await axios.post(SEARCH_VOLUME_URL, body, {
      auth: { username: c.login, password: c.password },
      timeout: opts.timeout ?? 30000,
    });

    const envelope = res.data ?? {};
    const task = envelope.tasks?.[0] ?? {};
    console.log(
      `[keywordVolume] HTTP ${res.status} · envelope ${envelope.status_code} · task ${task.status_code} ${task.status_message ?? ''} · location_code ${location_code} · ${missing.length} of ${unique.length} keywords (rest cached)`,
    );

    if (envelope.status_code !== 20000 || task.status_code !== 20000) {
      console.warn(
        `[keywordVolume] non-OK status — body: ${JSON.stringify(envelope).slice(0, 400)}`,
      );
      return out;
    }

    const results: any[] = task.result ?? [];
    const fetched = new Map<string, number | null>();
    for (const item of results) {
      const kw = String(item?.keyword || '').trim().toLowerCase();
      if (!kw) continue;
      const vol = item?.search_volume;
      const v = typeof vol === 'number' ? vol : null;
      out.set(kw, v);
      fetched.set(kw, v);
    }
    // Cache misses that came back with no row at all → store as null so we
    // don't re-ask next audit.
    for (const kw of missing) if (!fetched.has(kw)) fetched.set(kw, null);

    if (KeywordVolumeCache && fetched.size) {
      try {
        await KeywordVolumeCache.bulkWrite(
          Array.from(fetched.entries()).map(([kw, v]) => ({
            updateOne: {
              filter: { key: `${kw}::${location_code}` },
              update: { $set: { key: `${kw}::${location_code}`, keyword: kw, locationCode: location_code, searchVolume: v, fetchedAt: new Date() } },
              upsert: true,
            },
          })),
          { ordered: false },
        );
      } catch (err: any) {
        console.warn('[keywordVolume] cache write skipped:', err?.message);
      }
    }

    if (results.length === 0) console.warn('[keywordVolume] task OK but result array empty');
    return out;
  } catch (err: any) {
    const status = err?.response?.status;
    const msg = err?.response?.data?.status_message || err?.message || 'request failed';
    console.warn(`[keywordVolume] request error (HTTP ${status ?? '?'}): ${msg}`);
    return out;
  }
}
