import axios from 'axios';
import { meter } from '@/lib/providerMeter';
import { waitForGoogleAdsSlot } from '@/lib/googleAdsRateGate';
import { adsKeyword, resolveGoogleAdsLocation } from './keywordVolumeClient';

/**
 * Keyword discovery from Google Ads (DataForSEO), for the keyword system's
 * research stage (docs/KEYWORD_SYSTEM_PLAN.md S1):
 *
 *   fetchKeywordIdeas  keywords_for_keywords — related searches for up to 20
 *                      seed phrases, each with its monthly volume
 *   fetchSiteKeywords  keywords_for_site — searches Google Ads associates
 *                      with a competitor's website, each with its volume
 *
 * One task per call (~ the search-volume task price). Never throws: a
 * missing login, a disabled endpoint or a failed call returns [] and the
 * research simply runs with fewer sources.
 */

const IDEAS_URL = 'https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live';
const SITE_URL = 'https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_site/live';
const MAX_SEEDS = 20;

export interface KeywordIdea {
  keyword: string;
  /** Monthly searches at the requested location; null = too few to report. */
  volume: number | null;
}

function creds(): { username: string; password: string } | null {
  const username = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  return username && password ? { username, password } : null;
}

function location(opts: { locationCode?: number | null; countryHint?: string }): number {
  return opts.locationCode ?? resolveGoogleAdsLocation(opts.countryHint).location_code;
}

/** Parse a Google Ads keywords task into ideas, highest volume first, capped. */
export function parseIdeas(envelope: any, max: number): KeywordIdea[] {
  const task = envelope?.tasks?.[0];
  if (envelope?.status_code !== 20000 || task?.status_code !== 20000) return [];
  const rows: any[] = Array.isArray(task.result) ? task.result : [];
  const seen = new Set<string>();
  const out: KeywordIdea[] = [];
  for (const r of rows) {
    const keyword = String(r?.keyword || '').trim().toLowerCase();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    out.push({ keyword, volume: typeof r?.search_volume === 'number' ? r.search_volume : null });
  }
  return out.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1)).slice(0, max);
}

async function post(url: string, body: unknown, meterKey: 'dataForSeoAdsIdeasLiveTask' | 'dataForSeoAdsSiteLiveTask', reason: string, max: number): Promise<KeywordIdea[]> {
  const auth = creds();
  if (!auth) return [];
  try {
    await waitForGoogleAdsSlot(reason);
    const res = await axios.post(url, body, { auth, timeout: 45000 });
    meter(meterKey, 1, reason);
    const ideas = parseIdeas(res.data, max);
    const task = res.data?.tasks?.[0];
    if (!ideas.length) console.warn(`[keywordIdeas] ${reason}: no ideas (envelope ${res.data?.status_code}, task ${task?.status_code} ${task?.status_message ?? ''})`);
    return ideas;
  } catch (err: any) {
    console.warn(`[keywordIdeas] ${reason} failed (HTTP ${err?.response?.status ?? '?'}): ${err?.response?.data?.status_message || err?.message}`);
    return [];
  }
}

export async function fetchKeywordIdeas(
  seeds: string[],
  opts: { locationCode?: number | null; countryHint?: string; max?: number } = {},
): Promise<KeywordIdea[]> {
  const clean = Array.from(new Set(seeds.map((s) => adsKeyword(s)).filter((s): s is string => !!s))).slice(0, MAX_SEEDS);
  if (!clean.length) return [];
  return post(
    IDEAS_URL,
    [{ keywords: clean, location_code: location(opts), language_code: 'en', sort_by: 'search_volume' }],
    'dataForSeoAdsIdeasLiveTask',
    `keyword_ideas (${clean.length} seeds)`,
    opts.max ?? 400,
  );
}

/** The bare host of a website URL ("https://www.abc.in/x" → "abc.in"), or null. */
export function siteDomain(website: string | null | undefined): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(String(website || '')) ? String(website) : `https://${website}`);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    // Listings / social pages are not the competitor's own site.
    if (!host.includes('.') || /(^|\.)(google|facebook|instagram|justdial|indiamart|sulekha|practo|linkedin|youtube|wa\.me|business\.site)\b/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export async function fetchSiteKeywords(
  website: string,
  opts: { locationCode?: number | null; countryHint?: string; max?: number } = {},
): Promise<KeywordIdea[]> {
  const target = siteDomain(website);
  if (!target) return [];
  return post(
    SITE_URL,
    [{ target, target_type: 'site', location_code: location(opts), language_code: 'en', sort_by: 'search_volume' }],
    'dataForSeoAdsSiteLiveTask',
    `competitor_site_keywords (${target})`,
    opts.max ?? 150,
  );
}
