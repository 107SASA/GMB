/**
 * Free report keyword shortlist (docs/FREE_REPORT_REBUILD_PLAN.md Part C).
 * Pure: the caller fetches ideas, volumes and ranks.
 *
 *   1. services   Google categories, the AI's search terms, website services
 *   2. gaps       website services no Google category covers
 *   3. candidates every possible keyword — the connected audit's own
 *                 buildCandidates (services × city / areas, Google Ads ideas,
 *                 "near me"), plus "shop" / "manufacturer" / "wholesaler"
 *                 for products and makers; ideas only when grounded in the
 *                 business's own words
 *   4. volume     (caller) one lookup for all
 *   5. shortlist  ~10: the main services' city phrases first, areas with
 *                 searches, at most one "near me" (none for online
 *                 businesses), then the best of the rest
 *   6. ranks      (caller) only the shortlist is rank-checked
 *
 * Same building blocks as the connected audit (seo/keywordResearch,
 * seo/keywordSet), so the free report's keywords carry over when the owner
 * connects Google.
 */
import { buildCandidates, isGenericCategory } from '../seo/keywordResearch.ts';
import { serviceId, words } from '../seo/ids.ts';
import { evidenceStem, evidenceWords } from './businessUnderstanding.ts';
import type { VerifiedService } from '../seo/trackedKeywords.ts';
import type { KeywordCandidate, ScoredKeyword } from '../seo/keywordTypes.ts';

export const FREE_SHORTLIST_LIMITS = {
  /** Keywords rank-checked per free report. */
  max: 10,
  /** "near me" phrases among them (nationwide volume always favours them; searched from the pin they are nearly always #1). */
  maxNearMe: 1,
  /** City phrases of the main services always checked, even without a Google number. */
  mainServices: 5,
  /** Area phrases (with real searches) among them. */
  maxAreaPhrases: 2,
  /** Candidates per report (one Google Ads volume task holds 700). */
  maxCandidates: 300,
  /** Services used as keyword-ideas seeds. */
  ideaSeeds: 10,
};

/** Words that say what kind of offer, not what is offered ("classes", "service", "shop"). */
const KIND_WORDS = new Set([
  'class', 'classes', 'service', 'services', 'center', 'centre', 'shop', 'store', 'showroom', 'near', 'nearby',
  'course', 'courses', 'institute', 'training', 'trainer', 'price', 'prices', 'cost', 'fee', 'fees', 'charges',
  'online', 'home', 'company', 'agency', 'provider', 'providers', 'dealer', 'dealers', 'manufacturer', 'manufacturers',
  'supplier', 'suppliers', 'wholesaler', 'wholesalers', 'exporter', 'exporters', 'for', 'and', 'the', 'with', 'from',
  'best', 'top', 'cheap', 'local', 'professional', 'expert', 'experts', 'near me',
]);

const MAKER_WORD = /\b(manufacturer|manufacturers|supplier|suppliers|wholesaler|wholesalers|exporter|exporters|factory)\b/i;
const SHOP_WORD = /\b(shop|store|showroom|mart|dealer|dealers)\b/i;
const NEAR_ME = /\bnear me\b/i;

const tidy = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Step 1 — what the business offers, strongest evidence first: the AI's
 * search terms (already checked against the listing + website), the Google
 * categories (not the vague ones: "Store", "Consultant"), then website
 * services. Products / makers also get their "shop" / "manufacturer" shapes,
 * so the candidates include "<product> shop <city>".
 */
export function freeReportServices(input: {
  aiTerms: string[];
  categories: Array<string | null | undefined>;
  websiteServices: string[];
  offered?: 'services' | 'products' | 'both' | 'made_to_order' | null;
}): VerifiedService[] {
  const out: VerifiedService[] = [];
  const seen = new Set<string>();
  const add = (name: string, source: VerifiedService['source']) => {
    const n = tidy(name);
    if (!n || n.split(' ').length > 6) return;
    const id = serviceId(n);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, name: n, source, state: 'VERIFIED' } as VerifiedService);
  };
  const terms = (input.aiTerms || []).map(tidy).filter(Boolean);
  terms.forEach((t) => add(t, 'category'));
  // A category that only names a kind of business ("Manufacturer",
  // "Wholesaler", "Store") is never a keyword on its own.
  for (const c of input.categories || []) if (c && !isGenericCategory(c) && offerWords(c, []).length) add(c, 'category');
  for (const s of input.websiteServices || []) add(s, 'website');
  for (const t of terms.slice(0, 2)) {
    if (input.offered === 'made_to_order' && !MAKER_WORD.test(t)) { add(`${t} manufacturer`, 'category'); add(`${t} wholesaler`, 'category'); }
    if ((input.offered === 'products' || input.offered === 'both') && !SHOP_WORD.test(t)) add(`${t} shop`, 'category');
  }
  return out;
}

/** The offer words of a phrase: places, "near me" and kind words removed. */
function offerWords(phrase: string, places: string[]): string[] {
  let t = ` ${tidy(phrase)} `;
  for (const p of places.map(tidy).filter((x) => x.length >= 3)) t = t.split(` ${p} `).join(' ');
  t = t.replace(/\bnear me\b/g, ' ');
  return words(t).filter((w) => w.length >= 3 && !KIND_WORDS.has(w));
}

/**
 * A keyword from Google Ads ideas or a competitor's site is used only when
 * every offer word in it appears in the business's own listing / website
 * ("power yoga mohali" needs "power" there) — Google suggests related
 * searches, not what this business sells.
 */
export function groundedInBusiness(phrase: string, evidence: Set<string>, places: string[]): boolean {
  const ws = offerWords(phrase, places).flatMap((w) => evidenceWords(w));
  return ws.length > 0 && ws.every((w) => evidence.has(evidenceStem(w)));
}

/** US / UK spellings of the same word, so "jewelry" and "jewellery" are one service. */
const SPELLING: Record<string, string> = {
  jewelry: 'jewellery', jeweler: 'jeweller', jewelers: 'jewellers', center: 'centre', centers: 'centres',
  theater: 'theatre', color: 'colour', colors: 'colours', aluminum: 'aluminium', tire: 'tyre', tires: 'tyres',
};
/** A word in one comparable form: one spelling, one stem. */
const norm = (w: string) => evidenceStem(SPELLING[w] || w);
const offerStems = (phrase: string, places: string[] = []) => offerWords(phrase, places).map(norm);

/**
 * The service's main word: its last offer word ("tools" in "jewellery tools",
 * "repair" in "ac repair", "yoga" in "yoga classes" — "classes" is a kind word).
 */
function headOf(service: string): string | null {
  // "abrasives for jewellery" sells abrasives: the words after "for" say who it is for.
  const before = offerStems(` ${tidy(service)} `.split(/ (?:for|of) /)[0]);
  const ws = before.length ? before : offerStems(service);
  const offer = ws.filter((w) => !VENUE.has(w));
  const pick = offer.length ? offer : ws;
  return pick.length ? pick[pick.length - 1] : null;
}

/**
 * Words that name the place, not what is offered: the main word of "biryani
 * restaurant" is "biryani", of "dental clinic" "dental", of "beauty salon"
 * "beauty" (a service that is only "restaurant" keeps it).
 */
const VENUE = new Set([
  'restaurant', 'cafe', 'café', 'hotel', 'dhaba', 'clinic', 'hospital', 'salon', 'parlour', 'parlor', 'studio',
  'gym', 'academy', 'school', 'institute', 'boutique', 'lab', 'laboratory', 'agency', 'firm', 'office', 'outlet',
].map((w) => evidenceStem(w)));

/**
 * A Google idea names one of the business's services only when it keeps that
 * service's main word. All its words being the business's own is not enough:
 * "goldsmith near me" (people who want a goldsmith) shares a word with
 * "goldsmith supplies" but drops "supplies" and so is another trade; "ac near
 * me" is not "ac repair". "goldsmith tools", "yoga near me", "power yoga" keep it.
 */
export function keepsAServiceHead(phrase: string, services: Array<{ name: string }>, places: string[]): boolean {
  const ws = new Set(offerStems(phrase, places));
  return services.some((s) => {
    const head = headOf(s.name);
    return !!head && ws.has(head);
  });
}

/** One key for services that are the same offer ("jewellery tools" / "jewellery tools shop" / "Jewelry tools supplier"). */
export function serviceGroupKey(service: string): string {
  const ws = offerStems(service);
  const offer = ws.filter((w) => !VENUE.has(w));
  return [...new Set(offer.length ? offer : ws)].sort().join(' ');
}

/**
 * Step 2 — services the website lists that no Google category covers
 * ("Meditation classes" on the site; categories "Yoga studio", "Yoga
 * instructor"). Compared by offer words, so "Group yoga" is covered by
 * "Yoga studio". With a connected profile, pass its services list as `google`.
 */
export function websiteServicesNotOnGoogle(websiteServices: string[], google: Array<string | null | undefined>, max = 5): string[] {
  const covered = new Set((google || []).flatMap((g) => offerWords(String(g || ''), [])).map(evidenceStem));
  if (!covered.size) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of websiteServices || []) {
    const name = String(s || '').replace(/\s+/g, ' ').trim();
    const ws = offerWords(name, []).map(evidenceStem);
    if (!name || !ws.length || name.split(' ').length > 6) continue;
    if (ws.some((w) => covered.has(w))) continue;
    const key = ws.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Step 3 — every possible keyword. Online businesses get no "near me"
 * (customers don't search for them by distance).
 */
export function freeReportCandidates(input: {
  businessName: string;
  city: string;
  /** Areas served (website / Google) first, then clean nearby localities. */
  areas: string[];
  services: VerifiedService[];
  ideas: Array<{ keyword: string; volume: number | null }>;
  /** Stems of the business's own words (businessUnderstanding.evidenceStems). */
  evidence: Set<string>;
  servedHow?: 'storefront' | 'service_area' | 'hybrid' | 'online' | null;
  competitorNames?: string[];
}): KeywordCandidate[] {
  const places = [input.city, ...input.areas];
  // Google's ideas come country-wide ("yoga", "yoga classes"): an idea with
  // no place gets the city ("yoga mohali"); one naming another town is not
  // grounded (that town is not in the business's words) and is dropped.
  const city = tidy(input.city);
  const hasPlace = (k: string) => NEAR_ME.test(k) || places.some((p) => p && ` ${tidy(k)} `.includes(` ${tidy(p)} `));
  const ideas = (input.ideas || [])
    .filter((i) => groundedInBusiness(i.keyword, input.evidence, places) && keepsAServiceHead(i.keyword, input.services, places))
    .map((i) => (hasPlace(i.keyword) || !city ? i : { keyword: `${tidy(i.keyword)} ${city}`, volume: null }));
  const all = buildCandidates({
    businessName: input.businessName,
    category: null,
    city: input.city,
    serviceAreas: input.areas,
    ownerKeywords: [],
    services: input.services,
    gbpSearchTerms: [],
    googleIdeas: ideas,
    competitorKeywords: [],
    competitorNames: input.competitorNames || [],
    ownerRemoved: [],
    limits: { maxCandidates: FREE_SHORTLIST_LIMITS.maxCandidates },
  });
  return input.servedHow === 'online' ? all.filter((c) => !NEAR_ME.test(c.keyword)) : all;
}

const searches = (k: ScoredKeyword) => k.volume.city ?? k.volume.country ?? k.ideaVolume ?? 0;
const hasSearches = (k: ScoredKeyword) => (searches(k) ?? 0) > 0;
const inPlace = (k: ScoredKeyword, place: string) => !!place && ` ${k.keyword} `.includes(` ${tidy(place)} `);

/**
 * Step 5 — the keywords to rank-check, in priority order:
 *  1. each main service's city phrase (most-searched service first), even
 *     when Google has no number for the exact phrase — it shows real competition;
 *  2. up to 2 area phrases with real searches;
 *  3. at most `maxNearMe` "near me" phrase;
 *  4. the best-scoring rest with real searches (Google Ads ideas included);
 *  5. more city phrases.
 * Never: keywords tied to no service, "best / top" claim words.
 */
export function pickShortlist(
  scored: ScoredKeyword[],
  opts: {
    city: string; areas: string[]; servedHow?: string | null; limits?: Partial<typeof FREE_SHORTLIST_LIMITS>;
    /** The Google categories: a service named by one comes first when Google has no numbers. */
    categories?: Array<string | null | undefined>;
  },
): ScoredKeyword[] {
  const L = { ...FREE_SHORTLIST_LIMITS, ...(opts.limits || {}) };
  const maxNearMe = opts.servedHow === 'online' ? 0 : L.maxNearMe;
  const pool = scored.filter((k) => k.verdict !== 'not_relevant' && k.verdict !== 'claim_word');
  const byScore = [...pool].sort((a, b) => b.score - a.score || searches(b) - searches(a));
  const isNear = (k: ScoredKeyword) => NEAR_ME.test(k.keyword);
  const isCity = (k: ScoredKeyword) => !isNear(k) && inPlace(k, opts.city);
  const isArea = (k: ScoredKeyword) => !isNear(k) && !isCity(k) && opts.areas.some((a) => inPlace(k, a));

  const picked: ScoredKeyword[] = [];
  let nearMe = 0;
  const add = (k: ScoredKeyword | undefined) => {
    if (!k || picked.length >= L.max || picked.some((p) => p.id === k.id)) return;
    if (isNear(k)) { if (nearMe >= maxNearMe) return; nearMe++; }
    picked.push(k);
  };

  // Services that are the same offer ("jewellery tools", "jewellery tools
  // shop", "Jewelry tools supplier") form one group: every group gets one
  // keyword before any group gets a second shape of the same offer.
  const groupOf = (k: ScoredKeyword) => (k.service ? serviceGroupKey(k.service) || k.serviceId : null);
  const groupFirst = new Map<string, number>();
  const groupDemand = new Map<string, number>();
  pool.forEach((k, i) => {
    const g = groupOf(k);
    if (!g) return;
    if (!groupFirst.has(g)) groupFirst.set(g, i);
    groupDemand.set(g, Math.max(groupDemand.get(g) ?? 0, searches(k)));
  });
  const groups = [...groupFirst.keys()];
  const evidenceOrder = [...groups].sort((a, b) => groupFirst.get(a)! - groupFirst.get(b)!);
  // When Google has no numbers, order by how sure we are the business sells it:
  //  1. a service whose main word a Google category names;
  //  2. the business's first two services, and services connected to others
  //     (sharing a word: "abrasives for jewellery" with "jewellery tools");
  //  3. a service mentioned on its own, nowhere else ("rodium bath").
  const catStems = new Set((opts.categories || []).filter((c): c is string => !!c && !isGenericCategory(c)).flatMap((c) => offerStems(c)));
  const headOfGroup = (g: string) => {
    const k = pool.find((x) => groupOf(x) === g);
    return k?.service ? headOf(k.service) : null;
  };
  const tier = (g: string) => {
    const head = headOfGroup(g);
    if (head && catStems.has(head)) return 0;
    const stems = g.split(' ');
    const connected = groups.some((o) => o !== g && o.split(' ').some((w) => stems.includes(w)));
    return evidenceOrder.indexOf(g) < 2 || connected ? 1 : 2;
  };
  const groupOrder = [...groups].sort((a, b) =>
    (groupDemand.get(b) ?? 0) - (groupDemand.get(a) ?? 0) || tier(a) - tier(b) || groupFirst.get(a)! - groupFirst.get(b)!);

  // A group's city phrase: the most searched; on a tie the service's own
  // wording ("meditation classes mohali") over a Google idea ("class meditation
  // mohali"), then the shortest ("jewellery tools bengaluru" over "… shop …").
  const own = (k: ScoredKeyword) => (k.service && k.keyword.startsWith(`${k.service} `) ? 0 : 1);
  const cityPhrases = (g: string) =>
    pool.filter((k) => groupOf(k) === g && isCity(k)).sort((a, b) => searches(b) - searches(a) || own(a) - own(b) || a.keyword.length - b.keyword.length);
  const cityPhraseOf = (g: string) => cityPhrases(g).find((k) => !picked.some((p) => p.id === k.id));

  groupOrder.slice(0, L.mainServices).forEach((g) => add(cityPhraseOf(g)));
  byScore.filter((k) => isArea(k) && hasSearches(k)).slice(0, L.maxAreaPhrases).forEach(add);
  // "near me": the most searched one whose service is among the main ones.
  const mainGroups = new Set(groupOrder.slice(0, L.mainServices));
  byScore.filter((k) => isNear(k) && mainGroups.has(groupOf(k) || '')).forEach(add);
  byScore.filter(isNear).forEach(add);
  // Only phrases tied to a place: a country-wide "yoga" searched from the
  // business's own pin says nothing about local competition.
  byScore.filter((k) => (isCity(k) || isArea(k)) && hasSearches(k)).forEach(add);
  // Then one phrase for every service not checked yet, then second shapes ("… shop …").
  const checked = () => new Set(picked.map(groupOf));
  groupOrder.filter((g) => !checked().has(g)).forEach((g) => add(cityPhraseOf(g)));
  groupOrder.forEach((g) => add(cityPhraseOf(g)));
  return picked;
}

/**
 * Google categories that at least `minCompetitors` same-trade competitors
 * ranked above the business use, and the business does not ("Yoga
 * instructor" on 2 studios above you, not on yours). Public data only.
 */
export function categoriesCompetitorsUse(
  own: Array<string | null | undefined>,
  competitorsAbove: Array<{ name: string; category: string | null; additionalCategories?: string[] | null }>,
  minCompetitors = 2,
  max = 3,
): Array<{ category: string; competitors: string[] }> {
  const mine = new Set((own || []).map((c) => tidy(String(c || ''))).filter(Boolean));
  const by = new Map<string, { category: string; competitors: string[] }>();
  for (const c of competitorsAbove || []) {
    const cats = new Set([c.category, ...(c.additionalCategories || [])].map((x) => String(x || '').trim()).filter(Boolean));
    for (const cat of cats) {
      const key = tidy(cat);
      if (mine.has(key) || isGenericCategory(cat)) continue;
      const row = by.get(key) ?? { category: cat, competitors: [] };
      if (!row.competitors.includes(c.name)) row.competitors.push(c.name);
      by.set(key, row);
    }
  }
  return Array.from(by.values())
    .filter((r) => r.competitors.length >= minCompetitors)
    .sort((a, b) => b.competitors.length - a.competitors.length || a.category.localeCompare(b.category))
    .slice(0, max);
}
