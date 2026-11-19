/**
 * Which businesses shown above the target on Google Maps are actually in the
 * same trade. Pure (no imports) so tests load it directly.
 *
 * A real case (Durva Fireworks, Janori, Nov 2026): Google category "Store",
 * so every "store …" search returned pharmacies, kirana shops, clothing and
 * hardware stores — 24 of the 25 "competitors" were unrelated, and the one
 * real competitor ("Matoshree Fireworks") was ALSO categorised just "Store".
 * Google categories are often generic or wrong on both sides, so no single
 * field decides:
 *
 *  - a matching category (primary or additional) confirms on its own;
 *  - a generic category ("Store", "Shop", none) is neutral — the business
 *    counts only with trade evidence: two independent signals (name, Maps
 *    snippet, website) confirm; one signal counts as probable only when
 *    Google itself returned the business for a trade-specific search;
 *  - a specific, different category ("Pharmacy", "Clothing store") excludes
 *    it unless its name AND an independent source (website or snippet) both
 *    show the trade — a keyword in the name alone never overrides it.
 *
 * Trade terms include local and alternative words (fireworks / firecrackers /
 * crackers / fataka …) via TRADE_SYNONYMS; extend that list as new trades
 * come up. Without any trade term for the target, nothing is filtered.
 */

/** Alternative and local words for the same trade. Each group is one trade. */
export const TRADE_SYNONYMS: string[][] = [
  ['fireworks', 'firework', 'firecrackers', 'firecracker', 'crackers', 'cracker', 'fataka', 'fatake', 'phataka', 'phatake', 'fatakda', 'patakha', 'patakhe', 'pataka', 'patake', 'sparklers', 'atishbazi', 'aatishbaazi'],
  ['sweets', 'sweet', 'mithai', 'halwai', 'mithaiwala'],
  ['jewellery', 'jewellers', 'jeweller', 'jewelry', 'jewelers', 'jeweler', 'sarafa', 'saraf'],
  ['opticals', 'optical', 'optician', 'opticians', 'eyewear', 'spectacles'],
  ['electricals', 'electrical', 'electrician', 'electricians'],
  ['mobile', 'mobiles', 'smartphone', 'smartphones', 'cellphone'],
  ['pharmacy', 'chemist', 'chemists', 'medical', 'medicals', 'druggist'],
  ['kirana', 'grocery', 'groceries', 'provision', 'provisions'],
  ['bakery', 'bakers', 'baker', 'cake', 'cakes'],
  ['tailor', 'tailors', 'tailoring'],
];

/**
 * Words that describe the KIND of outlet, not the trade — a category made only
 * of these ("Store", "General store", "Shop") carries no trade signal.
 */
const GENERIC_WORDS = new Set([
  'store', 'stores', 'shop', 'shops', 'retail', 'retailer', 'retailers', 'mart', 'outlet', 'centre', 'center',
  'general', 'variety', 'department', 'dealer', 'dealers', 'distributor', 'distributors', 'supplier', 'suppliers',
  'wholesaler', 'wholesalers', 'wholesale', 'agency', 'agencies', 'enterprise', 'enterprises', 'trader', 'traders',
  'trading', 'company', 'service', 'services', 'business', 'establishment', 'point', 'interest', 'local', 'indian',
  'and', 'the', 'of', 'in', 'for', 'near', 'me', 'best', 'top', 'online', 'house', 'world', 'hub',
]);

const words = (s: string | null | undefined): string[] =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);

/** The trade-carrying words of a category or search phrase ("Fireworks store" → ["fireworks"]). */
export function specificWords(label: string | null | undefined): string[] {
  return words(label).filter((w) => !GENERIC_WORDS.has(w));
}

/** A term plus every alternative word of its trade group. */
function expand(term: string): string[] {
  const group = TRADE_SYNONYMS.find((g) => g.includes(term));
  return group ? group : [term];
}

export interface TradeProfile {
  /** Every word that marks the target's trade, alternatives included. */
  terms: string[];
  /** Where the trade came from, for the report's evidence line. */
  basis: string[];
}

/**
 * The target's trade, from what it is actually searched and listed as: the
 * search phrase used for ranking, its own Google category (primary +
 * additional, GBP when connected). Null when none carries a trade word —
 * then competitors are not filtered (no basis to judge them).
 */
export function buildTradeProfile(input: {
  searchCategory?: string | null;
  category?: string | null;
  additionalCategories?: Array<string | null | undefined> | null;
}): TradeProfile | null {
  const basis: string[] = [];
  const terms = new Set<string>();
  const add = (label: string | null | undefined, source: string) => {
    const found = specificWords(label);
    if (!found.length) return;
    basis.push(`${source}: ${label}`);
    for (const w of found) for (const t of expand(w)) terms.add(t);
  };
  add(input.searchCategory, 'searched as');
  add(input.category, 'Google category');
  for (const c of input.additionalCategories || []) add(c, 'additional category');
  return terms.size ? { terms: Array.from(terms), basis } : null;
}

/** Singular form for matching ("plumbers" → "plumber", "bakeries" → "bakery"); short words untouched. */
const singular = (w: string) =>
  w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;

const mentions = (text: string | null | undefined, terms: string[]): string | null => {
  const ws = new Set(words(text).map(singular));
  return terms.find((t) => ws.has(singular(t))) ?? null;
};

export type TradeMatchLevel = 'confirmed' | 'probable' | 'unverified' | 'unrelated';

export interface TradeMatch {
  level: TradeMatchLevel;
  /** Counted as a competitor (confirmed / probable). */
  counted: boolean;
  /** Human-readable evidence, e.g. 'name mentions "fireworks"'. */
  signals: string[];
}

export interface CompetitorEvidence {
  name: string;
  category?: string | null;
  additionalCategories?: string[] | null;
  /** Maps listing snippet / description, when Google gives one. */
  snippet?: string | null;
  /** What the competitor's own website says (title, description, services), when read. */
  websiteText?: string | null;
  /** The searches it appeared above the target in. */
  keywords?: string[];
}

export function classifyCompetitor(c: CompetitorEvidence, profile: TradeProfile): TradeMatch {
  const t = profile.terms;
  const signals: string[] = [];
  const categories = [c.category, ...(c.additionalCategories || [])].filter(Boolean) as string[];

  const categoryHit = categories.map((cat) => ({ cat, term: mentions(cat, t) })).find((x) => x.term);
  if (categoryHit) {
    return { level: 'confirmed', counted: true, signals: [`Google category "${categoryHit.cat}"`] };
  }

  const nameTerm = mentions(c.name, t);
  if (nameTerm) signals.push(`name mentions "${nameTerm}"`);
  const snippetTerm = mentions(c.snippet, t);
  if (snippetTerm) signals.push(`Maps listing mentions "${snippetTerm}"`);
  const websiteTerm = mentions(c.websiteText, t);
  if (websiteTerm) signals.push(`website mentions "${websiteTerm}"`);
  const independent = (snippetTerm ? 1 : 0) + (websiteTerm ? 1 : 0);

  const specificCategory = categories.find((cat) => specificWords(cat).length > 0);
  if (specificCategory) {
    // A different, specific category: only the name AND an independent source together outweigh it.
    if (nameTerm && independent > 0) return { level: 'confirmed', counted: true, signals: [...signals, `listed as "${specificCategory}"`] };
    return { level: 'unrelated', counted: false, signals: [`different category "${specificCategory}"`, ...signals] };
  }

  // Generic or missing category — neutral; the trade evidence decides.
  const evidence = (nameTerm ? 1 : 0) + independent;
  if (evidence >= 2) return { level: 'confirmed', counted: true, signals };
  const tradeSearch = (c.keywords || []).find((k) => mentions(k, t));
  if (evidence === 1 && tradeSearch) {
    return { level: 'probable', counted: true, signals: [...signals, `shown by Google for "${tradeSearch}"`, `generic category "${c.category || 'none'}"`] };
  }
  return { level: 'unverified', counted: false, signals: signals.length ? signals : [`generic category "${c.category || 'none'}", no trade evidence`] };
}
