/**
 * Business-specific search terms (pure — runs under `node --test`).
 *
 * When Google lists a business under only a generic category ("Services"),
 * the services its own website states are the best available search terms.
 * They are SOURCE_CLAIMs, so every keyword built from them is labelled
 * 'website_service' — measured like any other keyword, never presented as a
 * verified service.
 */

export type KeywordSource = 'category' | 'website_service' | 'owner' | 'ai_proposed' | 'brand';

const SERVICE_NOUN = /\b(development|design|designer|training|course|classes|repair|installation|service|services|clinic|marketing|software|consult\w*|agency|school|salon|cleaning|coaching|tuition|automation|app|apps|erp|seo|accounting|legal|dental|physiotherapy|photography|catering|interior)\b/i;

/** Best website service to use as a local search term, or null. */
export function pickServiceForSearch(services: string[]): string | null {
  const scored = services
    .map((s) => String(s || '').trim())
    .filter((s) => s.length >= 3 && s.split(/\s+/).length <= 5 && /[a-z]/i.test(s))
    .map((s, i) => ({ s, score: (SERVICE_NOUN.test(s) ? 3 : 0) - (/[&/+]/.test(s) ? 1 : 0) - (s.split(/\s+/).length > 3 ? 1 : 0) - i * 0.01 }));
  scored.sort((a, b) => b.score - a.score);
  return scored.length && scored[0].score > 0 ? scored[0].s : null;
}

/** A website service name as a search phrase: "AI & Automation" → "ai and automation". */
export function toSearchPhrase(s: string): string {
  return String(s || '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Local search phrases for the top website services ("website development nashik"). */
export function websiteServiceKeywords(services: string[], city: string, max = 3): string[] {
  const c = String(city || '').trim().toLowerCase();
  const out: string[] = [];
  for (const s of services) {
    const base = toSearchPhrase(s);
    if (!base || base.split(' ').length > 5 || !/[a-z]/.test(base)) continue;
    const kw = c && !base.includes(c) ? `${base} ${c}` : base;
    if (!out.includes(kw)) out.push(kw);
    if (out.length >= max) break;
  }
  return out;
}

/** Where a searched keyword came from (for the keyword table label). */
export function keywordSource(keyword: string, opts: { websiteServices: string[]; ownerTerms: string[]; branded: boolean }): KeywordSource {
  if (opts.branded) return 'brand';
  const k = String(keyword || '').toLowerCase().replace(/&/g, 'and');
  const has = (terms: string[]) => terms.some((t) => {
    const x = String(t || '').toLowerCase().replace(/&/g, 'and').trim();
    return x.length >= 3 && k.includes(x);
  });
  if (has(opts.ownerTerms)) return 'owner';
  if (has(opts.websiteServices)) return 'website_service';
  return 'category';
}

/**
 * An AI-proposed keyword is kept only if it is built from a verified or
 * website-stated service/category AND a real location of the business —
 * and it is always labelled "proposed — not measured".
 */
export function isGroundedKeywordProposal(keyword: string, opts: { terms: string[]; locations: string[]; brandPhrase: string }): boolean {
  const k = String(keyword || '').toLowerCase().trim();
  if (k.length < 5 || k.split(/\s+/).length > 7) return false;
  if (opts.brandPhrase && k.includes(opts.brandPhrase)) return false;
  const words = (s: string) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const termHit = opts.terms.some((t) => words(t).some((w) => k.includes(w)));
  const locHit = opts.locations.some((l) => String(l || '').trim().length >= 3 && k.includes(String(l).toLowerCase().trim()));
  return termHit && (locHit || /\bnear me\b/.test(k));
}
