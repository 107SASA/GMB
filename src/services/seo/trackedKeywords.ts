/**
 * The keywords a business is measured on, kept STABLE across monthly audits
 * so rankings can be compared like-for-like. Pure (no I/O).
 *
 * Each month:
 *  - every keyword tracked last month stays (history is never broken), unless
 *    the service it belongs to is no longer listed anywhere — then it is
 *    removed with that reason;
 *  - at most `maxNewPerMonth` new keywords are added, from (in order):
 *      1. one "<service> <city>" phrase per verified service not yet tracked;
 *      2. Google Business Profile search terms (Google-reported impressions)
 *         that match a verified service;
 *      3. last month's AI-proposed keywords (so a proposal gets MEASURED
 *         instead of staying an unmeasured suggestion forever);
 *      4. "<service> near me" for the first verified services;
 *  - the total of keywords measured beyond the main ranking grid is capped.
 * Keywords never come from nowhere: each carries its source and reason.
 * Service names come only from Google (VERIFIED), the owner's own list
 * (OWNER_CONFIRMED) or, when neither exists, the website (SOURCE_CLAIM);
 * with no service at all, the Google category stands in as the one service.
 */
import { keywordId, serviceId, stem, words } from './ids.ts';

export type ServiceState = 'VERIFIED' | 'OWNER_CONFIRMED' | 'SOURCE_CLAIM';

export interface VerifiedService {
  id: string;
  name: string;
  source: 'gbp' | 'owner' | 'website' | 'category';
  state: ServiceState;
}

export type KeywordSource = 'grid' | 'previous' | 'service_cluster' | 'gbp_search_term' | 'proposed' | 'near_me';

export interface TrackedKeyword {
  id: string;
  keyword: string;
  serviceId: string | null;
  service: string | null;
  intent: 'local' | 'near_me' | 'service';
  source: KeywordSource;
  /** When it first entered tracking (ISO). */
  addedAt: string;
  reason: string;
}

export interface KeywordChange {
  id: string;
  keyword: string;
  change: 'added' | 'removed' | 'not_added';
  reason: string;
}

export const TRACKING_LIMITS = {
  maxServices: 6,
  /** Keywords measured beyond the main ranking grid (3 points each). */
  maxExtraKeywords: 8,
  /** New keywords per month — rotation without breaking comparisons. */
  maxNewPerMonth: 4,
};

const SERVICE_FILLER = new Set(['service', 'services', 'and', 'the', 'for', 'with', 'near', 'best', 'top']);

/**
 * Services from the strongest source first. A website-only service is used
 * only when Google and the owner list none. Category is the fallback.
 */
export function verifiedServices(input: {
  gbpServices?: string[];
  ownerServices?: string[];
  websiteServices?: string[];
  category?: string | null;
  max?: number;
}): VerifiedService[] {
  const out: VerifiedService[] = [];
  const seen = new Set<string>();
  const add = (raw: string, source: VerifiedService['source'], state: ServiceState) => {
    const name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (name.length < 3 || name.length > 50 || !/[a-z]/i.test(name)) return;
    const id = serviceId(name);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, name, source, state });
  };
  for (const s of input.gbpServices || []) add(s, 'gbp', 'VERIFIED');
  for (const s of input.ownerServices || []) add(s, 'owner', 'OWNER_CONFIRMED');
  if (!out.length) for (const s of input.websiteServices || []) add(s, 'website', 'SOURCE_CLAIM');
  if (!out.length && input.category) add(input.category, 'category', 'VERIFIED');
  return out.slice(0, input.max ?? TRACKING_LIMITS.maxServices);
}

/** The service a keyword is about (shared meaningful word), or null. */
export function serviceForKeyword(keyword: string, services: VerifiedService[]): VerifiedService | null {
  const kw = new Set(words(keyword).map(stem));
  let best: { s: VerifiedService; hits: number } | null = null;
  for (const s of services) {
    const sw = words(s.name).filter((w) => !SERVICE_FILLER.has(w)).map(stem);
    const hits = sw.filter((w) => kw.has(w)).length;
    if (hits && (!best || hits > best.hits)) best = { s, hits };
  }
  return best?.s ?? null;
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const withCity = (phrase: string, city: string) =>
  city && !phrase.toLowerCase().includes(city.toLowerCase()) ? `${phrase} ${city}` : phrase;
const intentOf = (k: string): TrackedKeyword['intent'] => (/\bnear me\b/i.test(k) ? 'near_me' : 'local');
const CLAIM = /\b(best|top|cheapest|no\.? ?1|number one|leading|famous)\b/i;

export function buildTrackedKeywords(input: {
  previous: TrackedKeyword[];
  services: VerifiedService[];
  city: string;
  /** Phrases the main ranking grid measures this audit (always tracked). */
  gridKeywords: string[];
  /** Google Business Profile search terms with Google-reported impressions. */
  searchTerms: Array<{ keyword: string; impressions: number; period?: string }>;
  /** Last month's AI-proposed keywords (unmeasured until now). */
  proposed: string[];
  businessName: string;
  now: Date;
  limits?: Partial<typeof TRACKING_LIMITS>;
}): { tracked: TrackedKeyword[]; measureNow: TrackedKeyword[]; changes: KeywordChange[] } {
  const L = { ...TRACKING_LIMITS, ...(input.limits || {}) };
  const nowIso = input.now.toISOString();
  const changes: KeywordChange[] = [];
  const byId = new Map<string, TrackedKeyword>();
  const serviceIds = new Set(input.services.map((s) => s.id));
  const brand = words(input.businessName)[0] || '';

  // Grid phrases: tracked as measured by the main grid.
  for (const g of input.gridKeywords) {
    const id = keywordId(g);
    if (byId.has(id)) continue;
    const prev = input.previous.find((p) => p.id === id);
    const svc = serviceForKeyword(g, input.services);
    byId.set(id, {
      id, keyword: g, serviceId: svc?.id ?? null, service: svc?.name ?? null, intent: intentOf(g), source: 'grid',
      addedAt: prev?.addedAt ?? nowIso, reason: prev?.reason ?? 'Main ranking search for the business category',
    });
  }

  // Last month's keywords stay unless their service is gone.
  const extra: TrackedKeyword[] = [];
  for (const p of input.previous) {
    if (byId.has(p.id) || p.source === 'grid') continue;
    if (p.serviceId && !serviceIds.has(p.serviceId)) {
      changes.push({ id: p.id, keyword: p.keyword, change: 'removed', reason: `"${p.service}" is no longer listed as a service` });
      continue;
    }
    extra.push(p);
  }

  // New candidates, in priority order.
  const candidates: Array<{ keyword: string; service: VerifiedService | null; source: KeywordSource; reason: string }> = [];
  const trackedServices = new Set([...byId.values(), ...extra].map((k) => k.serviceId).filter(Boolean));
  for (const s of input.services) {
    if (trackedServices.has(s.id)) continue;
    candidates.push({ keyword: withCity(s.name, input.city), service: s, source: 'service_cluster', reason: `Service "${s.name}" (${s.state === 'VERIFIED' ? 'listed on Google' : s.state === 'OWNER_CONFIRMED' ? 'confirmed by the owner' : 'stated on the website'}) had no tracked keyword` });
  }
  for (const t of [...input.searchTerms].sort((a, b) => b.impressions - a.impressions)) {
    const svc = serviceForKeyword(t.keyword, input.services);
    if (!svc || !(t.impressions > 0)) continue;
    candidates.push({ keyword: t.keyword, service: svc, source: 'gbp_search_term', reason: `Customers found the profile with this search (${t.impressions} impressions${t.period ? `, ${t.period}` : ''} — Google Business Profile)` });
  }
  for (const p of input.proposed) {
    const svc = serviceForKeyword(p, input.services);
    if (!svc) continue;
    candidates.push({ keyword: p, service: svc, source: 'proposed', reason: 'Proposed in last month’s SEO plan — now measured' });
  }
  for (const s of input.services.slice(0, 2)) {
    candidates.push({ keyword: `${s.name} near me`, service: s, source: 'near_me', reason: `"Near me" search for "${s.name}"` });
  }

  let added = 0;
  for (const c of candidates) {
    const keyword = tidy(c.keyword);
    const id = keywordId(keyword);
    if (!keyword || byId.has(id) || extra.some((e) => e.id === id)) continue;
    if (CLAIM.test(keyword) || (brand && words(keyword).includes(brand))) continue;
    if (extra.length >= L.maxExtraKeywords || added >= L.maxNewPerMonth) {
      changes.push({ id, keyword, change: 'not_added', reason: extra.length >= L.maxExtraKeywords ? 'Tracking limit reached — kept for a later month' : 'Monthly limit for new keywords reached' });
      continue;
    }
    const kw: TrackedKeyword = {
      id, keyword, serviceId: c.service?.id ?? null, service: c.service?.name ?? null,
      intent: intentOf(keyword), source: c.source, addedAt: nowIso, reason: c.reason,
    };
    extra.push(kw);
    added++;
    changes.push({ id, keyword, change: 'added', reason: c.reason });
  }

  // Service names may have been edited: keep the stored service label current.
  for (const e of extra) {
    if (e.serviceId) {
      const s = input.services.find((x) => x.id === e.serviceId);
      if (s) e.service = s.name;
    }
  }
  return { tracked: [...byId.values(), ...extra], measureNow: extra, changes };
}
