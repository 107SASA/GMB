/**
 * S1 of the free report (docs/FREE_REPORT_REBUILD_PLAN.md): what does this
 * business actually do, and what do its customers type into Google?
 *
 * Google has ~4,000 business categories and changes them often, so no word
 * list can cover every trade (Nov 2026: an LED display maker listed only as
 * "Manufacturer" was searched as "manufacturer near me" and "p1 25 near me").
 * The AI reads the business's own evidence — Google listing first, the
 * website only when there is one — and answers in a fixed shape. The code
 * then checks every answer against that evidence and drops what is not in it.
 *
 * Google's data decides the numbers (volume, rank); the AI only decides the
 * meaning (the trade, the offerings, the search terms). The answer is saved
 * per business with a hash of its inputs, so the same business gets the same
 * answer until its listing or website changes.
 *
 * Everything except `understandBusiness` is pure and unit-tested.
 */
import crypto from 'crypto';

/** Google's own 19 place-type groups (Places API "Table A"). */
export const INDUSTRIES = [
  'Automotive', 'Business', 'Culture', 'Education', 'Entertainment and Recreation', 'Facilities', 'Finance',
  'Food and Drink', 'Geographical Areas', 'Government', 'Health and Wellness', 'Housing', 'Lodging',
  'Natural Features', 'Places of Worship', 'Services', 'Shopping', 'Sports', 'Transportation',
] as const;
export type Industry = (typeof INDUSTRIES)[number];
/** How customers are served (Google's storefront / service-area / hybrid, plus remote). */
export type ServedHow = 'storefront' | 'service_area' | 'hybrid' | 'online';
/** What is offered — decides how keywords are phrased. */
export type Offered = 'services' | 'products' | 'both' | 'made_to_order';

export interface UnderstandingInput {
  name: string;
  city: string;
  area: string;
  primaryCategory: string | null;
  additionalCategories: string[];
  placeTypes: string[];
  /** Google's own listing description and the owner's (sign-up) one. */
  googleDescription: string | null;
  ownerDescription: string | null;
  /** false = the listing hides its address (a service-area business). */
  addressShown: boolean | null;
  websiteTitle: string | null;
  websiteDescription: string | null;
  websiteServices: string[];
}

export interface Offering {
  name: string;
  /** Where the evidence for it is ("google category", "description", "website", "name"). */
  source: string;
}

/**
 * A group of the business's items the way customers search for them:
 * "RODHIUM BATH" + "RODHIUM PEN" → "rhodium plating solution";
 * "Chicken dum biryani" + "Mutton biryani" → "biryani".
 */
export interface OfferFamily {
  name: string;
  /** The website items / categories it groups (each one really in the evidence). */
  covers: string[];
}

/** Does one of the listing's own extra Google categories fit what the business does? */
export interface CategoryFit {
  category: string;
  fits: 'yes' | 'no' | 'unsure';
  reason: string;
}

export interface Understanding {
  industry: Industry | null;
  servedHow: ServedHow;
  offered: Offered;
  /** One line: "cashew processing and wholesale". */
  trade: string;
  /** Real products / services, most important first (max 6). */
  offerings: Offering[];
  /** What customers type, WITHOUT a place ("psychologist", "counselling centre"). Max 8. */
  searchTerms: string[];
  /** Google categories that count as the same trade (checked in phase 3). */
  sameTradeCategories: string[];
  /** The website's items grouped the way customers search (max 8). Missing on answers saved before v2. */
  families?: OfferFamily[];
  /** The AI's view of each extra Google category on the listing. Missing on answers saved before v2. */
  categoryFit?: CategoryFit[];
  /** The AI's view of the PRIMARY category (v3): does it describe what the business does? */
  primaryFit?: { fits: 'yes' | 'no' | 'unsure'; reason: string; better: string | null } | null;
  confidence: 'high' | 'medium' | 'low';
  inputsHash: string;
  createdAt: string;
  model: string;
}

const SERVED: ServedHow[] = ['storefront', 'service_area', 'hybrid', 'online'];
const OFFERED: Offered[] = ['services', 'products', 'both', 'made_to_order'];
export const UNDERSTANDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Bump when the prompt or the checks change, so saved answers are rebuilt. */
// v2 (Nov 2026): offer families (website items grouped as customers search, spelling fixed) + extra-category fit.
// v3 (Nov 2026): primary-category fit + a better Google category when it does not fit.
export const UNDERSTANDING_VERSION = 3;

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The input with empty parts removed and long text cut — also what the hash covers. */
export function normalizeInput(i: UnderstandingInput): UnderstandingInput {
  return {
    name: clip(i.name, 120),
    city: clip(i.city, 60),
    area: clip(i.area, 60),
    primaryCategory: clip(i.primaryCategory, 80) || null,
    additionalCategories: (i.additionalCategories || []).map((c) => clip(c, 80)).filter(Boolean).slice(0, 9),
    placeTypes: (i.placeTypes || []).map((t) => clip(t, 40)).filter((t) => t && !/^(point_of_interest|establishment|premise|political)$/.test(t)).slice(0, 8),
    googleDescription: clip(i.googleDescription, 400) || null,
    ownerDescription: clip(i.ownerDescription, 400) || null,
    addressShown: typeof i.addressShown === 'boolean' ? i.addressShown : null,
    websiteTitle: clip(i.websiteTitle, 150) || null,
    websiteDescription: clip(i.websiteDescription, 400) || null,
    websiteServices: (i.websiteServices || []).map((s) => clip(s, 80)).filter(Boolean).slice(0, 25),
  };
}

export function inputsHash(i: UnderstandingInput): string {
  return crypto.createHash('sha256').update(JSON.stringify([UNDERSTANDING_VERSION, normalizeInput(i)])).digest('hex').slice(0, 32);
}

export function understandingPrompt(raw: UnderstandingInput): string {
  const i = normalizeInput(raw);
  return `You are classifying a local business from its Google Business Profile, for an SEO report in India.
Use ONLY the evidence below. Never invent products, services, places or facts. If the evidence is thin, say so with "confidence": "low".

EVIDENCE (JSON):
${JSON.stringify(i)}

Notes on the evidence:
- "primaryCategory" and "additionalCategories" are what the owner chose on Google — the strongest evidence.
- A category that only names the KIND of business ("Manufacturer", "Supplier", "Exporter", "Wholesaler", "Services", "Company") does not say what is sold; look for the product in the name, the descriptions and the website.
- "websiteServices" are headings read from the website; many are menu text ("Follow Us", "Before", "Search", product codes like "P1.25"). Ignore anything that is not a real product or service.
- "addressShown": false means the business visits customers (service-area).

Answer with JSON only, exactly these keys:
{
 "industry": one of ${JSON.stringify(INDUSTRIES)},
 "servedHow": one of ["storefront","service_area","hybrid","online"]  (online = customers mostly deal remotely: software, agencies, exporters, investment firms),
 "offered": one of ["services","products","both","made_to_order"]  (made_to_order = manufacturer / processor / wholesaler / exporter),
 "trade": "one short line, e.g. 'cashew processing and wholesale'",
 "offerings": [{"name": "real product or service, 1-4 words, as customers say it", "source": "google category | description | website | name"}]  (most important first, max 6),
 "searchTerms": ["what a customer types into Google to find this kind of business, 1-4 words, WITHOUT any city, area, 'near me', 'best' or the business name"]  (max 8; the business's MAIN line of work first, side services last),
 "sameTradeCategories": ["Google Business Profile category names a direct competitor would have"]  (max 8),
 "families": [{"name": "what customers type for a GROUP of the items in websiteServices / the categories, 1-4 words, e.g. 'Chicken dum biryani' + 'Mutton biryani' → 'biryani'", "covers": ["the exact websiteServices items or categories it groups"]}]  (max 8, main line first; you may correct the spelling of a word that is misspelt in the evidence, e.g. 'rodhium' → 'rhodium', but never add a product, treatment or dish the evidence does not show),
 "primaryFit": {"fits": "yes" | "no" | "unsure", "reason": "short", "better": "only when fits is no: the real Google Business Profile category that describes this business, else null"}  (about primaryCategory; "no" only when the business clearly does something else — e.g. a shop selling tools TO jewellers listed as "Jewelry store"),
 "categoryFit": [{"category": "one of additionalCategories, exactly as written", "fits": "yes" | "no" | "unsure", "reason": "short: why it does or does not describe what this business does"}]  (one per additionalCategories item; "no" only when the business clearly does not do that — e.g. a shop selling tools TO goldsmiths is not a "Goldsmith"),
 "confidence": "high" | "medium" | "low"
}`;
}

// ── Checking the AI's answer against the evidence ─────────────────────────

const STOP = new Set(['and', 'the', 'for', 'with', 'from', 'our', 'your', 'all', 'more', 'new', 'service', 'services',
  'company', 'shop', 'store', 'centre', 'center', 'provider', 'solutions', 'solution', 'india', 'indian']);
const words = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/** A short stem, so "counselling" ~ "counselor", "psychologist" ~ "psychology". */
const stem = (w: string) => (w.length > 6 ? w.slice(0, 6) : w.replace(/(ies|es|s)$/, ''));

/** The word / stem rules evidenceStems uses — anything checked against the evidence must use these. */
export const evidenceWords = words;
export const evidenceStem = stem;

/** Adds free text (a website's page text) to an evidence set. */
export function addEvidenceText(set: Set<string>, text: string): Set<string> {
  for (const w of words(text)) if (w.length >= 3) set.add(stem(w));
  return set;
}

/** Every word the evidence contains, as stems. */
export function evidenceStems(raw: UnderstandingInput): Set<string> {
  const i = normalizeInput(raw);
  const text = [i.name, i.primaryCategory, ...i.additionalCategories, ...i.placeTypes.map((t) => t.replace(/_/g, ' ')),
    i.googleDescription, i.ownerDescription, i.websiteTitle, i.websiteDescription, ...i.websiteServices].join(' ');
  return new Set(words(text).filter((w) => w.length >= 3).map(stem));
}

/** True when at least one meaningful word of the phrase is in the evidence. */
export function isGrounded(phrase: string, stems: Set<string>): boolean {
  const ws = words(phrase).filter((w) => w.length >= 3 && !STOP.has(w));
  return ws.length > 0 && ws.some((w) => stems.has(stem(w)));
}

const BAD_TERM = /\b(best|top|no\.?\s*1|number\s*1|cheap(est)?|near\s*me|near\s+by|nearby|famous|leading|trusted)\b/i;

/** A search term the code can safely build keywords from. */
export function cleanSearchTerm(term: string, opts: { brandWords: string[]; places: string[] }): string | null {
  let t = String(term ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  for (const p of opts.places) {
    const pl = String(p || '').toLowerCase().trim();
    if (pl.length >= 3) t = t.replace(new RegExp(`\\b${pl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim();
  }
  t = t.replace(/\b(in|at|near)$/, '').trim();
  if (!t || t.length < 3 || BAD_TERM.test(t)) return null;
  const ws = t.split(' ');
  if (ws.length > 5 || !/\p{L}/u.test(t)) return null;
  // The business's own name is a brand search, not a customer search.
  if (opts.brandWords.length && opts.brandWords.every((b) => ws.includes(b))) return null;
  // A term that is only a kind-of-business word says nothing ("manufacturer", "services").
  if (ws.every((w) => STOP.has(w) || /^(manufacturer|manufacturers|supplier|suppliers|wholesaler|wholesalers|exporter|exporters|dealer|dealers|agency|business)$/.test(w))) return null;
  return t;
}

/** Old and new names of the same city ("Bengaluru" / "Bangalore") — a term must not carry either. */
const CITY_ALIASES: string[][] = [
  ['bengaluru', 'bangalore'], ['mumbai', 'bombay'], ['chennai', 'madras'], ['kolkata', 'calcutta'],
  ['gurugram', 'gurgaon'], ['mysuru', 'mysore'], ['vadodara', 'baroda'], ['pune', 'poona'],
  ['thiruvananthapuram', 'trivandrum'], ['kochi', 'cochin'], ['mangaluru', 'mangalore'], ['puducherry', 'pondicherry'],
  ['belagavi', 'belgaum'], ['kalaburagi', 'gulbarga'], ['hubballi', 'hubli'], ['prayagraj', 'allahabad'],
];
export function cityAliases(city: string): string[] {
  const c = String(city || '').toLowerCase().trim();
  return CITY_ALIASES.find((g) => g.includes(c))?.filter((x) => x !== c) ?? [];
}

/**
 * Official district names Google writes in addresses → the name people type
 * (Nov 2026: a Mohali yoga studio's address said "Sahibzada Ajit Singh Nagar";
 * every "<service> sahibzada ajit singh nagar" phrase had no searches, so the
 * report checked only "near me" phrases and showed #1 everywhere).
 */
const COMMON_CITY_NAME: Record<string, string> = {
  'sahibzada ajit singh nagar': 'Mohali', 'sas nagar': 'Mohali', 's.a.s. nagar': 'Mohali', 'sas nagar mohali': 'Mohali', 'ajitgarh': 'Mohali',
  'gautam buddh nagar': 'Noida', 'gautam buddha nagar': 'Noida',
  'rangareddy': 'Hyderabad', 'ranga reddy': 'Hyderabad', 'medchal-malkajgiri': 'Hyderabad', 'medchal malkajgiri': 'Hyderabad',
  'bengaluru urban': 'Bengaluru', 'bangalore urban': 'Bengaluru',
  'mumbai suburban': 'Mumbai', 'mumbai city': 'Mumbai',
  'kamrup metropolitan': 'Guwahati', 'kamrup metro': 'Guwahati',
  'ernakulam': 'Kochi', 'dakshina kannada': 'Mangaluru',
  'new delhi': 'Delhi', 'south delhi': 'Delhi', 'north delhi': 'Delhi', 'east delhi': 'Delhi', 'west delhi': 'Delhi',
  'central delhi': 'Delhi', 'south west delhi': 'Delhi', 'north west delhi': 'Delhi', 'north east delhi': 'Delhi',
  'south east delhi': 'Delhi', 'shahdara': 'Delhi',
  'sri potti sriramulu nellore': 'Nellore', 'ysr kadapa': 'Kadapa', 'ysr district': 'Kadapa',
  'purba bardhaman': 'Bardhaman', 'paschim bardhaman': 'Asansol',
};

/** The city name customers type in a search ("Sahibzada Ajit Singh Nagar" → "Mohali"); unchanged when not an official-only name. */
export function searchCityName(city: string): string {
  const raw = String(city || '').trim();
  const key = raw.toLowerCase().replace(/\s+district$/, '').replace(/\s+/g, ' ').trim();
  return COMMON_CITY_NAME[key] ?? raw;
}

/** The distinctive words of a business name (for spotting brand searches). */
export function brandWords(name: string): string[] {
  return words(name).filter((w) => w.length >= 3 && !STOP.has(w) && !/^(pvt|ltd|private|limited|llp|industries|enterprises|technologies)$/.test(w)).slice(0, 2);
}

/**
 * The AI's raw JSON → a checked Understanding, or null when nothing usable is
 * left. Offerings and terms not grounded in the evidence are dropped; Google's
 * own signals win over the AI where they exist (a hidden address is never a
 * storefront).
 */
export function parseUnderstanding(rawJson: any, input: UnderstandingInput, meta: { model: string; now: Date }): Understanding | null {
  if (!rawJson || typeof rawJson !== 'object') return null;
  const i = normalizeInput(input);
  const stems = evidenceStems(i);
  const places = [i.city, i.area, ...cityAliases(i.city)].filter(Boolean);
  const brand = brandWords(i.name);

  const offerings: Offering[] = [];
  const seenOff = new Set<string>();
  for (const o of Array.isArray(rawJson.offerings) ? rawJson.offerings : []) {
    const name = clip(typeof o === 'string' ? o : o?.name, 60).toLowerCase();
    if (!name || name.split(' ').length > 5 || seenOff.has(name) || !isGrounded(name, stems)) continue;
    seenOff.add(name);
    offerings.push({ name, source: clip(typeof o === 'object' ? o?.source : '', 30) || 'evidence' });
    if (offerings.length >= 6) break;
  }

  const terms: string[] = [];
  const offeringStems = new Set(offerings.flatMap((o) => words(o.name).map(stem)));
  for (const t of Array.isArray(rawJson.searchTerms) ? rawJson.searchTerms : []) {
    const c = cleanSearchTerm(String(t ?? ''), { brandWords: brand, places });
    // A term must tie to the evidence or to a checked offering.
    if (!c || terms.includes(c)) continue;
    if (!isGrounded(c, stems) && !words(c).some((w) => offeringStems.has(stem(w)))) continue;
    terms.push(c);
    if (terms.length >= 8) break;
  }
  // Offerings are search terms too when the AI gave too few.
  for (const o of offerings) {
    if (terms.length >= 8) break;
    const c = cleanSearchTerm(o.name, { brandWords: brand, places });
    if (c && !terms.includes(c)) terms.push(c);
  }

  if (!offerings.length && !terms.length) return null;

  const industry = (INDUSTRIES as readonly string[]).includes(rawJson.industry) ? (rawJson.industry as Industry) : null;
  let servedHow: ServedHow = SERVED.includes(rawJson.servedHow) ? rawJson.servedHow : 'storefront';
  if (i.addressShown === false && (servedHow === 'storefront' || servedHow === 'hybrid')) servedHow = 'service_area';
  const offered: Offered = OFFERED.includes(rawJson.offered) ? rawJson.offered : 'services';
  const sameTradeCategories = (Array.isArray(rawJson.sameTradeCategories) ? rawJson.sameTradeCategories : [])
    .map((c: unknown) => clip(c, 80)).filter((c: string) => c && c.split(' ').length <= 6).slice(0, 8);

  let confidence: Understanding['confidence'] = ['high', 'medium', 'low'].includes(rawJson.confidence) ? rawJson.confidence : 'medium';
  // Fewer than 2 checked terms, or nothing grounded in Google's own fields → never "high".
  if (terms.length < 2 && confidence === 'high') confidence = 'medium';
  if (!terms.length) confidence = 'low';

  return {
    industry, servedHow, offered,
    trade: clip(rawJson.trade, 100) || offerings[0]?.name || terms[0] || '',
    offerings, searchTerms: terms, sameTradeCategories, confidence,
    families: checkFamilies(rawJson.families, i, stems),
    categoryFit: checkCategoryFit(rawJson.categoryFit, i),
    primaryFit: i.primaryCategory && rawJson.primaryFit && typeof rawJson.primaryFit === 'object'
      ? {
          fits: ['yes', 'no', 'unsure'].includes(rawJson.primaryFit.fits) ? rawJson.primaryFit.fits : 'unsure',
          reason: clip(rawJson.primaryFit.reason, 160),
          better: rawJson.primaryFit.fits === 'no' ? (clip(rawJson.primaryFit.better, 80) || null) : null,
        }
      : null,
    inputsHash: inputsHash(input), createdAt: meta.now.toISOString(), model: meta.model,
  };
}

/** Letters apart (adjacent swaps count once): "rodhium" → "rhodium" is 2, "jewelery" → "jewellery" is 1. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** A spelling fix of a word in the evidence: same first letter, ≥ 5 letters, at most 2 apart ("rodhium" → "rhodium", never "bath" → "bathroom"). */
export function isSpellingFixOf(word: string, evidenceWord: string): boolean {
  if (word === evidenceWord || word.length < 5 || evidenceWord.length < 5) return false;
  if (word[0] !== evidenceWord[0]) return false;
  return editDistance(word, evidenceWord) <= 2 && Math.abs(word.length - evidenceWord.length) <= 2;
}

/** Words a family name may add that name a kind of offer, not a new product ("python batch" → "python course"). */
const FAMILY_KIND_WORDS = new Set(['course', 'courses', 'class', 'classes', 'training', 'service', 'services', 'repair', 'shop', 'store',
  'supplier', 'suppliers', 'dealer', 'dealers', 'solution', 'solutions', 'products', 'equipment', 'tools', 'treatment']);

/**
 * The AI's families, checked: each covers ≥ 1 item really in the evidence,
 * and every word of its name is the business's own, a kind word, or a
 * spelling fix of a word in what it covers. Anything else is dropped.
 */
export function checkFamilies(raw: unknown, i: UnderstandingInput, stems: Set<string>): OfferFamily[] {
  const known = new Map<string, string>();
  for (const x of [...i.websiteServices, i.primaryCategory || '', ...i.additionalCategories]) {
    const k = clip(x, 80).toLowerCase();
    if (k) known.set(k, clip(x, 80));
  }
  const out: OfferFamily[] = [];
  for (const f of Array.isArray(raw) ? raw : []) {
    const name = clip((f as any)?.name, 60).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!name || name.split(' ').length > 5 || out.some((o) => o.name === name)) continue;
    const covers = (Array.isArray((f as any)?.covers) ? (f as any).covers : [])
      .map((c: unknown) => known.get(clip(c, 80).toLowerCase()))
      .filter((c: string | undefined): c is string => !!c);
    if (!covers.length) continue;
    const coverWords = covers.flatMap((c: string) => words(c));
    const ok = words(name).filter((w) => w.length >= 3).every((w) =>
      stems.has(stem(w)) || FAMILY_KIND_WORDS.has(w) || STOP.has(w) || coverWords.some((cw: string) => isSpellingFixOf(w, cw)));
    if (!ok) continue;
    out.push({ name, covers: [...new Set(covers)] as string[] });
    if (out.length >= 8) break;
  }
  return out;
}

/** The AI's view of each extra category — only categories really on the listing. */
export function checkCategoryFit(raw: unknown, i: UnderstandingInput): CategoryFit[] {
  const own = new Map(i.additionalCategories.map((c) => [c.toLowerCase(), c]));
  const out: CategoryFit[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const category = own.get(clip((r as any)?.category, 80).toLowerCase());
    if (!category || out.some((o) => o.category === category)) continue;
    const fits = ['yes', 'no', 'unsure'].includes((r as any)?.fits) ? (r as any).fits : 'unsure';
    out.push({ category, fits, reason: clip((r as any)?.reason, 160) });
  }
  return out;
}

/** A saved answer that can be reused: same inputs, same version, under 30 days old. */
export function isUnderstandingReusable(saved: Partial<Understanding> | null | undefined, input: UnderstandingInput, now: Date): saved is Understanding {
  return !!saved?.inputsHash && saved.inputsHash === inputsHash(input) && !!saved.createdAt &&
    now.getTime() - new Date(saved.createdAt).getTime() < UNDERSTANDING_TTL_MS;
}

/**
 * Ask the AI (or reuse the saved answer). Never throws: AI off, failing or
 * answering rubbish → `understanding: null`, and the report uses the rules.
 */
export async function understandBusiness(
  input: UnderstandingInput,
  opts: { saved?: Understanding | null; now?: Date } = {},
): Promise<{ understanding: Understanding | null; reused: boolean; error: string | null }> {
  const now = opts.now ?? new Date();
  if (isUnderstandingReusable(opts.saved, input, now)) return { understanding: opts.saved, reused: true, error: null };
  if (!process.env.GROQ_API_KEY) return { understanding: null, reused: false, error: 'GROQ_API_KEY not set' };
  try {
    const Groq = (await import('groq-sdk')).default;
    const { GROQ_MODEL } = await import('@/lib/aiModel');
    const { withGroqRetry } = await import('@/lib/groqRetry');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 });
    const res: any = await withGroqRetry(() => groq.chat.completions.create({
      model: process.env.FREE_REPORT_AI_MODEL || GROQ_MODEL,
      messages: [{ role: 'user', content: understandingPrompt(input) }],
      temperature: 0,
      response_format: { type: 'json_object' },
      reasoning_effort: 'low',
    } as any, { timeout: 15_000 }), { reason: 'business_understanding', retries: 1, maxWaitMs: 5_000 });
    const content = res?.choices?.[0]?.message?.content;
    const parsed = content ? JSON.parse(content) : null;
    const understanding = parseUnderstanding(parsed, input, { model: process.env.FREE_REPORT_AI_MODEL || GROQ_MODEL, now });
    return { understanding, reused: false, error: understanding ? null : 'AI answer had nothing usable' };
  } catch (err: any) {
    return { understanding: null, reused: false, error: String(err?.message || err).slice(0, 200) };
  }
}
