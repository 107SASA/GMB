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
import { evidenceStem, evidenceWords, isSpellingFixOf, type OfferFamily } from './businessUnderstanding.ts';
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
  /** The website's items grouped as customers search (checked by businessUnderstanding). */
  families?: OfferFamily[];
  /** Stems of the business's own words: a word not among them may be a misspelling to fix. */
  evidence?: Set<string> | null;
  /** Extra Google categories that do not fit what the business does — never used as an offer. */
  excludeCategories?: string[];
  /** The business's country: in India keywords use Indian (UK) spelling ("jewellery", "centre"). */
  country?: string | null;
}): VerifiedService[] {
  const families = input.families || [];
  // Spelling the family fixed ("rodhium" → "rhodium"), applied to every phrase.
  const familyWords = [...new Set(families.flatMap((f) => evidenceWords(f.name)))];
  const fixes = new Map<string, string>();
  for (const f of families) {
    for (const cw of f.covers.flatMap((c) => evidenceWords(c))) {
      const fw = familyWords.find((w) => isSpellingFixOf(w, cw));
      if (fw) fixes.set(cw, fw);
    }
  }
  const fixWords = (phrase: string, aiWritten: boolean) => evidenceWords(phrase).map((w) => {
    if (fixes.has(w)) return fixes.get(w)!;
    // A word the AI wrote that is not the business's own ("rodium") snaps to the family's spelling.
    if (aiWritten && input.evidence && !input.evidence.has(evidenceStem(w))) {
      const fw = familyWords.find((x) => isSpellingFixOf(x, w));
      if (fw) return fw;
    }
    return w;
  }).join(' ');
  const covered = new Set(families.flatMap((f) => f.covers.map((c) => tidy(c))));
  const excluded = new Set((input.excludeCategories || []).map((c) => tidy(c)));

  const out: VerifiedService[] = [];
  const seen = new Set<string>();
  // An offer with exactly the words of a category that does not fit is that
  // same wrong trade in other words ("jewelry wholesale" = "Wholesale jeweler").
  // Same words only: "yoga classes" shares "yoga" with "Yoga instructor" and stays.
  const wrongTrades = [...excluded].map((c) => new Set(offerWords(c, []).map((w) => evidenceStem(SPELLING[w] || w))))
    .filter((set) => set.size > 0);
  const isWrongTrade = (phrase: string) => {
    const ws = offerWords(phrase, []).map((w) => evidenceStem(SPELLING[w] || w));
    const own = new Set(ws);
    return own.size > 0 && wrongTrades.some((set) => set.size === own.size && [...own].every((w) => set.has(w)));
  };
  const india = !input.country || /^(in|ind|india)$/i.test(String(input.country).trim());
  const add = (name: string, source: VerifiedService['source']) => {
    const n = india ? indianSpelling(tidy(name)) : tidy(name);
    if (!n || n.split(' ').length > 6 || isWrongTrade(n)) return;
    const id = serviceId(n);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, name: n, source, state: 'VERIFIED' } as VerifiedService);
  };
  const terms = (input.aiTerms || []).map((t) => tidy(fixWords(t, true))).filter(Boolean);
  terms.forEach((t) => add(t, 'category'));
  // Families: the website's items as customers search for them. A product
  // seller's family is never "… services" ("rhodium services" → "rhodium").
  const sellsProducts = input.offered === 'products' || input.offered === 'made_to_order';
  for (const f of families) add(sellsProducts ? f.name.replace(/\s+services?\b/g, '').trim() : f.name, 'website');
  // A category that only names a kind of business ("Manufacturer",
  // "Wholesaler", "Store") is never a keyword on its own; nor is one that
  // does not fit what the business does ("Goldsmith" on a tool supplier).
  for (const c of input.categories || []) if (c && !isGenericCategory(c) && offerWords(c, []).length && !excluded.has(tidy(c))) add(c, 'category');
  // Website items a family covers are searched as that family.
  for (const s of input.websiteServices || []) if (!covered.has(tidy(s))) add(fixWords(s, false), 'website');
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
/** US → Indian (UK) spelling, word by word: Indian customers search "jewellery", "centre", "colour". */
export function indianSpelling(phrase: string): string {
  return String(phrase || '').split(' ').map((w) => SPELLING[w] || w).join(' ');
}

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
  // Not "office": it is often the product ("office furniture", "office chairs").
  'gym', 'academy', 'school', 'institute', 'boutique', 'lab', 'laboratory', 'agency', 'firm', 'outlet',
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

/**
 * Extra Google categories that do not fit what the business does: the AI
 * said "no", and the category's main word is the main word of none of the
 * business's offerings, families or search terms ("Goldsmith" on a shop
 * selling goldsmith supplies — "supplies" is what it sells). The primary
 * category is never passed here.
 */
export function categoriesThatDoNotFit(
  fit: Array<{ category: string; fits: string; reason?: string }> | null | undefined,
  sells: { offerings?: Array<{ name: string }>; families?: Array<{ name: string }>; searchTerms?: string[] },
): Array<{ category: string; reason: string }> {
  const heads = new Set([
    ...(sells.offerings || []).map((o) => o.name), ...(sells.families || []).map((f) => f.name), ...(sells.searchTerms || []),
  ].map((x) => headOf(x)).filter((h): h is string => !!h));
  return (fit || [])
    .filter((f) => f.fits === 'no' && !isGenericCategory(f.category))
    .filter((f) => { const h = headOf(f.category); return !!h && !heads.has(h); })
    .map((f) => ({ category: f.category, reason: f.reason || '' }));
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
    /**
     * The primary Google category: its own offer is the MAIN keyword (map + reach
     * check), even when a broader phrase has more searches ("office furniture",
     * not "furniture store", for an office furniture store).
     */
    primaryCategory?: string | null;
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

  // The primary category's own offer goes first: exactly its words, else a
  // group holding all of them ("office furniture" for "Office furniture store").
  if (opts.primaryCategory && !isGenericCategory(opts.primaryCategory)) {
    const key = serviceGroupKey(opts.primaryCategory);
    const words = key.split(' ').filter(Boolean);
    const main = words.length
      ? groupOrder.find((g) => g === key && cityPhrases(g).length)
        ?? groupOrder.find((g) => words.every((w) => g.split(' ').includes(w)) && cityPhrases(g).length)
      : undefined;
    if (main) groupOrder.splice(groupOrder.indexOf(main), 1), groupOrder.unshift(main);
  }

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

// ── Part E: more true, fixable issues (pure; v23) ──────────────────────────

/**
 * The primary category does not describe what the business does: the AI said
 * "no", and the category's main word is the main word of none of its
 * offerings, families or search terms (the same check as extra categories).
 * The suggested category is kept only when it is a real, specific name.
 */
export function primaryCategoryDoesNotFit(
  fit: { fits: string; reason?: string; better?: string | null } | null | undefined,
  primaryCategory: string | null | undefined,
  sells: { offerings?: Array<{ name: string }>; families?: Array<{ name: string }>; searchTerms?: string[] },
): { category: string; reason: string; better: string | null } | null {
  if (!fit || !primaryCategory) return null;
  const hit = categoriesThatDoNotFit([{ category: primaryCategory, fits: fit.fits, reason: fit.reason }], sells)[0];
  if (!hit) return null;
  const better = fit.better && !isGenericCategory(fit.better) && tidy(fit.better) !== tidy(primaryCategory) ? fit.better.trim() : null;
  return { category: primaryCategory, reason: hit.reason, better };
}

/**
 * A same-trade competitor ranked above uses a category with every word of the
 * business's primary category plus more ("Biryani restaurant" for
 * "Restaurant"), and the extra words are the business's own (it offers that).
 */
export function moreSpecificCategory(
  primaryCategory: string | null | undefined,
  competitorsAbove: Array<{ name: string; category: string | null; additionalCategories?: string[] | null }>,
  evidence: Set<string> | null | undefined,
): { category: string; competitors: string[] } | null {
  if (!primaryCategory || !evidence) return null;
  const own = new Set(evidenceWords(primaryCategory).map((w) => evidenceStem(SPELLING[w] || w)));
  if (!own.size) return null;
  const by = new Map<string, { category: string; competitors: string[] }>();
  for (const c of competitorsAbove || []) {
    for (const cat of [c.category, ...(c.additionalCategories || [])]) {
      if (!cat || isGenericCategory(cat)) continue;
      const ws = evidenceWords(cat).map((w) => evidenceStem(SPELLING[w] || w));
      const extra = ws.filter((w) => !own.has(w));
      if (!extra.length || ![...own].every((w) => ws.includes(w))) continue;
      if (!extra.every((w) => evidence.has(w))) continue;
      const row = by.get(tidy(cat)) ?? { category: cat, competitors: [] };
      if (!row.competitors.includes(c.name)) row.competitors.push(c.name);
      by.set(tidy(cat), row);
    }
  }
  return [...by.values()].sort((a, b) => b.competitors.length - a.competitors.length)[0] ?? null;
}

/**
 * Google has (almost) no searches for the primary category's own phrase,
 * while one of the business's own offers has real searches: the owner should
 * use the words customers type. Unknown volumes are never compared.
 */
export function categoryLowDemand(
  shortlist: ScoredKeyword[],
  primaryCategory: string | null | undefined,
  limits = { lowBelow: 10, betterAtLeast: 50 },
): { categoryKeyword: string; categoryVolume: number | null; betterKeyword: string; betterVolume: number } | null {
  if (!primaryCategory || isGenericCategory(primaryCategory) || !shortlist.length) return null;
  const key = serviceGroupKey(primaryCategory);
  const groupOf = (k: ScoredKeyword) => (k.service ? serviceGroupKey(k.service) : '');
  const cat = shortlist.find((k) => groupOf(k) === key && !NEAR_ME.test(k.keyword));
  if (!cat) return null;
  const catVol = cat.volume.city ?? cat.volume.country ?? null;
  if (catVol != null && catVol >= limits.lowBelow) return null;
  const better = shortlist
    .filter((k) => groupOf(k) !== key && !NEAR_ME.test(k.keyword))
    .map((k) => ({ k, v: k.volume.city ?? k.volume.country ?? 0 }))
    .filter((x) => x.v >= limits.betterAtLeast)
    .sort((a, b) => b.v - a.v)[0];
  return better ? { categoryKeyword: cat.keyword, categoryVolume: catVol, betterKeyword: better.k.keyword, betterVolume: better.v } : null;
}

/** Far fewer photos than the same-trade businesses ranked above (≥ 2 with a count). */
export function photosVsCompetitors(
  own: number | null | undefined,
  competitorsAbove: Array<{ name: string; totalPhotos?: number | null }>,
): { own: number; median: number; competitors: number } | null {
  if (typeof own !== 'number') return null;
  const counts = competitorsAbove.map((c) => c.totalPhotos).filter((n): n is number => typeof n === 'number').sort((a, b) => a - b);
  if (counts.length < 2) return null;
  const median = counts.length % 2 ? counts[(counts.length - 1) / 2] : Math.round((counts[counts.length / 2 - 1] + counts[counts.length / 2]) / 2);
  return own < 50 && own * 3 < median ? { own, median, competitors: counts.length } : null;
}
