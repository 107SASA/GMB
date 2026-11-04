/**
 * Stable identifiers for SEO measurements, so the same service, area and
 * keyword line up across monthly audits even when their display text changes
 * case or punctuation. Pure (no imports).
 *
 *   service  "svc:dental-implants"
 *   area     "area:address" (the business's own location),
 *            "area:pid:<Google place id>" or "area:name:<slug>"
 *   keyword  "kw:dental-implants-nashik"
 */

export function slug(s: string | null | undefined): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export const ADDRESS_AREA_ID = 'area:address';

export const serviceId = (name: string) => `svc:${slug(name)}`;
export const keywordId = (keyword: string) => `kw:${slug(keyword)}`;
export const areaId = (area: { placeId?: string | null; name?: string | null }) =>
  area.placeId ? `area:pid:${String(area.placeId).replace(/^places\//, '')}` : `area:name:${slug(area.name)}`;

/** Lower-case word list for matching (≥ 3 letters). */
export function words(s: string | null | undefined): string[] {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

/** Singular-ish stem so "implants" matches "implant", "bakeries" "bakery". */
export const stem = (w: string) =>
  w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
