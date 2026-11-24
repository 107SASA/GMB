/**
 * Review assistant: the customer taps a star rating, picks what they liked,
 * and gets a short draft review to post on the business's Google profile.
 * Pure rules (no database, no AI client) shared by /review/[token] and its
 * draft / feedback endpoints.
 *
 * Google policy guard rails, kept here so every caller follows them:
 *   - No review gating. Every rating, 1–5, gets the "Post on Google" button.
 *     Low ratings also get an optional private note to the owner, as an extra
 *     choice, never instead of Google.
 *   - Drafts are only offered for 4–5 stars, and only from what the customer
 *     picked or typed. The customer edits and posts it themselves.
 *   - At most one target keyword per draft, and only if it fits; each draft
 *     is worded differently, so a business's reviews don't read alike.
 */

export const DRAFT_MIN_RATING = 4;
export const MAX_CHIPS_PICKED = 4;
export const MAX_NOTE_CHARS = 200;
export const MAX_FEEDBACK_CHARS = 1000;
export const MAX_SERVICE_CHIPS = 6;

/** Fit every category type (shop, clinic, home service, restaurant, …). */
export const QUALITY_CHIPS = [
  'Great quality',
  'Friendly staff',
  'Quick service',
  'Good value for money',
  'Honest & helpful',
  'Professional',
] as const;

/** How the template draft says each quality chip. */
const QUALITY_SENTENCES: Record<string, string> = {
  'Great quality': 'The quality was great.',
  'Friendly staff': 'The staff were friendly.',
  'Quick service': 'The service was quick.',
  'Good value for money': 'Good value for money.',
  'Honest & helpful': 'They were honest and helpful.',
  'Professional': 'Very professional.',
};

export function wantsDraft(rating: number): boolean {
  return Number.isInteger(rating) && rating >= DRAFT_MIN_RATING && rating <= 5;
}

export function isValidRating(rating: unknown): rating is number {
  return typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

const lower = (s: string) => s.toLowerCase();

/** "ac repair" → "AC repair" style: first letter up, the rest as written. */
function chipLabel(value: string): string {
  const s = clean(value);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Service chips: the services our target keywords are about first, then the
 * owner's own service list. Short, distinct, no brand name.
 */
export function buildServiceChips(input: {
  keywordServices: Array<string | null | undefined>;
  ownerServices: Array<string | null | undefined>;
  businessName?: string | null;
}): string[] {
  const brand = lower(clean(input.businessName)).split(' ')[0] || '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...input.keywordServices, ...input.ownerServices]) {
    const label = chipLabel(String(raw ?? ''));
    const key = lower(label);
    if (label.length < 3 || label.length > 40) continue;
    if (brand.length >= 3 && key.includes(brand)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_SERVICE_CHIPS) break;
  }
  return out;
}

/** Keeps only chips the page offered; anything else is dropped. */
export function pickedChips(picked: unknown, offered: readonly string[]): string[] {
  if (!Array.isArray(picked)) return [];
  const allowed = new Map(offered.map((c) => [lower(c), c]));
  const out: string[] = [];
  for (const p of picked) {
    const hit = allowed.get(lower(clean(p)));
    if (hit && !out.includes(hit)) out.push(hit);
    if (out.length >= MAX_CHIPS_PICKED) break;
  }
  return out;
}

/** The customer's own words: one line, no links, capped. */
export function cleanNote(note: unknown, max = MAX_NOTE_CHARS): string {
  return clean(note).replace(/https?:\/\/\S+/gi, '').slice(0, max).trim();
}

/**
 * One keyword for this draft, or null. Prefers a keyword about a service the
 * customer picked; otherwise a random target. Many drafts get none, so one
 * business's reviews never all carry the same phrase. `rand` is injectable
 * for tests.
 */
export function chooseKeyword(keywords: string[], picked: string[], rand: () => number = Math.random): string | null {
  const list = keywords.map(clean).filter((k) => k.length >= 3 && k.length <= 60);
  if (!list.length) return null;
  const pickedLower = picked.map(lower);
  const matching = list.filter((k) => pickedLower.some((p) => lower(k).includes(p) || p.includes(lower(k))));
  const pool = matching.length ? matching : list;
  if (rand() < (matching.length ? 0.35 : 0.5)) return null;
  return pool[Math.floor(rand() * pool.length)] ?? null;
}

/** Opening styles; none of them invites a detail the customer didn't give. */
const STYLES = [
  'Start with what they came in for.',
  'Start with how they felt about the experience.',
  'Start with a short, simple sentence.',
  'Start with the business name.',
  'Start with the thing they liked most.',
];

export function buildDraftPrompt(input: {
  businessName: string;
  category?: string | null;
  rating: number;
  picked: string[];
  note: string;
  keyword: string | null;
  variant: number;
}): string {
  const style = STYLES[Math.abs(input.variant) % STYLES.length];
  const liked = input.picked.length ? input.picked.join(', ') : '(nothing picked)';
  return `Write a short Google review in the voice of a real customer of "${input.businessName}"${input.category ? ` (${input.category})` : ''}.

What they liked (tapped): ${liked}
Their own words: ${input.note ? `"${input.note}"` : '(none)'}
${input.keyword
    ? `Search phrase: "${input.keyword}". You may work its words in once, the way a person would say it — fix grammar, add "in"/"at", write short forms in capitals (AC, CA, IVF, PG), capitalise place names. Skip it if it doesn't fit.`
    : 'Do not add any search phrase.'}

Rules:
- First person, plain simple Indian English, 2–3 sentences, 25–60 words.
- Use ONLY the things listed above. Do not add any other praise or detail — no staff, price, speed, cleanliness, results or descriptions of the work unless they are listed. No names, prices, dates or products.
- ${input.rating === 4 ? 'Tone: good, warm, not over the top.' : 'Tone: happy and genuine, not exaggerated.'}
- Do not mention stars, ratings or numbers out of 5.
- ${style}
- No hashtags, no links, no phone numbers, no quotation marks. Usually no emoji; never more than one.
- Do not write as the business. Do not say "highly recommend". Do not say they searched for it or found it online.
Return only the review text.`;
}

const OPENERS_5 = ['Really happy with {b}.', 'Had a great experience at {b}.', 'Very good experience with {b}.', '{b} did a great job.'];
const OPENERS_4 = ['Good experience at {b}.', 'Happy with my visit to {b}.', 'Nice experience with {b}.'];
const CLOSERS_5 = ['Would recommend them.', 'Will come back again.', 'Thank you to the team!', 'Recommended.'];
const CLOSERS_4 = ['Would go again.', 'Worth a visit.', 'Thanks to the team.'];

function pick<T>(list: readonly T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length)] ?? list[0];
}

/** Lower-cases a leading capital, but leaves acronyms ("AC repair") alone. */
function softLower(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function joinList(items: string[]): string {
  const low = items.map(softLower);
  if (low.length <= 1) return low[0] || '';
  return `${low.slice(0, -1).join(', ')} and ${low[low.length - 1]}`;
}

/**
 * Draft without AI (Groq busy, rate-limited, or failed). Built only from what
 * the customer chose, so it never claims anything they didn't. No search
 * phrase: pasted raw into a template it reads like spam.
 */
export function fallbackDraft(input: {
  businessName: string;
  rating: number;
  picked: string[];
  serviceChips: readonly string[];
  note: string;
}, rand: () => number = Math.random): string {
  const b = clean(input.businessName) || 'them';
  const five = input.rating >= 5;
  const services = input.picked.filter((p) => input.serviceChips.includes(p));
  const qualities = input.picked.filter((p) => !input.serviceChips.includes(p));
  const parts: string[] = [pick(five ? OPENERS_5 : OPENERS_4, rand).replace('{b}', b)];
  if (services.length) parts.push(`Went to them for ${joinList(services)}.`);
  for (const q of qualities) parts.push(QUALITY_SENTENCES[q] || `${chipLabel(q)}.`);
  if (input.note) {
    const note = chipLabel(input.note);
    parts.push(/[.!?]$/.test(note) ? note : `${note}.`);
  }
  parts.push(pick(five ? CLOSERS_5 : CLOSERS_4, rand));
  return parts.join(' ');
}

/** The AI's text, or null when it isn't fit to show. */
export function cleanDraft(raw: unknown): string | null {
  let s = String(raw ?? '').trim();
  s = s.replace(/^["“'`]+|["”'`]+$/g, '').replace(/^review:\s*/i, '').replace(/\s+/g, ' ').trim();
  if (s.length < 40 || s.length > 600) return null;
  if (/https?:\/\/|www\.|@|#\w/i.test(s)) return null;
  if (/\d[\d\s-]{8,}\d/.test(s)) return null;
  if (/\b(as an ai|language model|here is|here's a)\b/i.test(s)) return null;
  return s;
}
