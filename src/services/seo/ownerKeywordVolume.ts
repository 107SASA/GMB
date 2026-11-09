/**
 * Search volume while the owner picks keywords at onboarding / Settings
 * (docs/KEYWORD_SYSTEM_PLAN.md §8). One rule everywhere, the same as the
 * Keywords page (keywordView.volumeView): the number the latest research
 * stored for that keyword (city first, then India), else Google Ads India
 * from the 45-day cache, else a live Google Ads lookup.
 *
 * Cost guard: at most LOOKUPS_PER_DAY live lookups per business per day
 * (each at most one Google Ads request, $0.09). Stored and cached numbers are
 * free and not counted. Over the limit, keywords come back without a number.
 */
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { cachedSearchVolumes, fetchSearchVolumes } from '@/services/audit/keywordVolumeClient';
import { cleanKeyword } from './keywordResearch';
import { volumeView } from './keywordView';

const LOOKUPS_PER_DAY = 8;
const MAX_KEYWORDS = 30;

/** keyword (as given) → monthly searches; null = too few; absent = not looked up. */
export async function ownerKeywordVolumes(
  businessId: string,
  keywords: string[],
  countryHint?: string | null,
): Promise<{ volumes: Record<string, number | null>; limited: boolean }> {
  const asked = Array.from(new Set(keywords.map((k) => String(k || '').trim()).filter((k) => cleanKeyword(k)))).slice(0, MAX_KEYWORDS);
  if (!asked.length) return { volumes: {}, limited: false };
  const volumes: Record<string, number | null> = {};

  // 1. What the latest research stored (same number the Keywords page shows).
  try {
    const { getActiveSeoPlan } = await import('@/services/seoPlan/seoPlanService');
    const plan: any = await getActiveSeoPlan(businessId);
    const stored = new Map<string, any>((plan?.keywordSet || []).map((k: any) => [String(k.keyword).toLowerCase(), k]));
    for (const k of asked) {
      const row = stored.get(k.toLowerCase());
      if (row?.volume && row.volume.status !== 'not_measured') volumes[k] = volumeView(row.volume).value;
    }
  } catch { /* no plan yet */ }

  // 2. The 45-day cache (free).
  let rest = asked.filter((k) => !(k in volumes));
  if (rest.length) {
    const cached = await cachedSearchVolumes(rest, { countryHint: countryHint || '' });
    for (const k of rest) if (cached.has(k.toLowerCase())) volumes[k] = cached.get(k.toLowerCase()) ?? null;
    rest = rest.filter((k) => !(k in volumes));
  }
  if (!rest.length) return { volumes, limited: false };

  // 3. Live lookup — capped per business per day.
  const gate = await checkDurableRateLimit(`kw-volume:${businessId}`, LOOKUPS_PER_DAY, 86_400_000);
  if (!gate.allowed) return { volumes, limited: true };
  const found = await fetchSearchVolumes(rest, { countryHint: countryHint || '' }).catch(() => new Map<string, number | null>());
  for (const k of rest) if (found.has(k.toLowerCase())) volumes[k] = found.get(k.toLowerCase()) ?? null;
  return { volumes, limited: false };
}
