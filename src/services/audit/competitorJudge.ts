/**
 * S5 of the free report (docs/FREE_REPORT_REBUILD_PLAN.md): is each business
 * Google showed above the target really in the same trade?
 *
 * Word matching cannot tell trades apart (Nov 2026: "health" let a women's
 * clinic in as a psychologist's competitor; "cleaning" made cleaning SERVICES
 * competitors of a cleaning PRODUCTS supplier). One AI call judges every
 * business found, from Google's own fields only (name, categories, listing
 * text), against what the target business does (businessUnderstanding.ts).
 *
 * Verdicts: yes (shown as a competitor) / no / unsure (listed under "other
 * businesses shown above you"). A business sharing the target's own specific
 * Google category is never called "no" — at worst "unsure". If the AI fails,
 * the caller keeps the rule-based result (competitorRelevance.ts).
 *
 * Everything except `judgeCompetitors` is pure and unit-tested.
 */
import crypto from 'crypto';

export type Verdict = 'yes' | 'no' | 'unsure';

export interface JudgeTarget {
  name: string;
  trade: string;
  offerings: string[];
  primaryCategory: string | null;
  additionalCategories: string[];
  servedHow: string;
  city: string;
}

export interface JudgeCandidate {
  /** Stable key (competitorFacts key). */
  key: string;
  name: string;
  category: string | null;
  additionalCategories: string[];
  snippet: string | null;
}

export interface Judgement {
  verdict: Verdict;
  reason: string;
}

/** Businesses judged per report: up to 40 seen above the target most often + up to 15 ranked below it. */
export const MAX_JUDGED = 35;
export const MAX_BELOW_JUDGED = 10;
export const JUDGE_VERSION = 1;
export const JUDGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function judgeHash(target: JudgeTarget, candidates: JudgeCandidate[]): string {
  return crypto.createHash('sha256')
    .update(JSON.stringify([JUDGE_VERSION, target, candidates.map((c) => [c.key, c.category, c.additionalCategories])]))
    .digest('hex').slice(0, 32);
}

export function judgePrompt(target: JudgeTarget, candidates: JudgeCandidate[]): string {
  const list = candidates.map((c, i) => ({
    id: i + 1,
    name: clip(c.name, 100),
    category: clip(c.category, 80) || null,
    otherCategories: c.additionalCategories.slice(0, 5).map((x) => clip(x, 60)),
    listingText: clip(c.snippet, 100) || null,
  }));
  return `You decide which businesses are DIRECT competitors of a local business in India, for an SEO report.

THE BUSINESS:
${JSON.stringify({
    name: clip(target.name, 120), trade: clip(target.trade, 120), offers: target.offerings.slice(0, 6),
    googleCategory: target.primaryCategory, otherCategories: target.additionalCategories.slice(0, 6), servedHow: target.servedHow, city: target.city,
  })}

BUSINESSES GOOGLE SHOWED IN THE SAME SEARCHES:
${JSON.stringify(list)}

A direct competitor is a business a customer of THE BUSINESS could choose INSTEAD of it, for the same main products or services.
- "yes": same trade (e.g. two psychologists; a cashew processor and a kaju wholesaler; two mobile repair shops).
- "no": a different trade, even if a word is shared (a women's health clinic is not a psychologist; a cleaning SERVICE is not a cleaning PRODUCTS supplier; a steel fabricator is not an LED display maker; a bank is not a property investment firm).
- "unsure": the evidence is too thin to tell (generic category like "Store" or "Manufacturer" and an unhelpful name).
Judge only from the fields given. Do not guess from a name alone when the category says otherwise.

Answer with JSON only: {"judgements": [{"id": 1, "verdict": "yes" | "no" | "unsure", "reason": "max 6 words"}]} — one entry for EVERY id.`;
}

const words = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3);
const KIND_ONLY = new Set(['manufacturer', 'supplier', 'wholesaler', 'exporter', 'company', 'service', 'services', 'store', 'shop', 'agency', 'dealer', 'business', 'local', 'establishment', 'center', 'centre']);

/** Same specific Google category as the target (not a kind-only one like "Manufacturer"). */
export function sharesSpecificCategory(target: Pick<JudgeTarget, 'primaryCategory'>, c: Pick<JudgeCandidate, 'category' | 'additionalCategories'>): boolean {
  const t = clip(target.primaryCategory, 80).toLowerCase();
  if (!t || words(t).every((w) => KIND_ONLY.has(w))) return false;
  return [c.category, ...c.additionalCategories].some((x) => clip(x, 80).toLowerCase() === t);
}

/** The AI's JSON → one judgement per candidate key. Missing or bad entries are "unsure". */
export function parseJudgements(raw: any, target: JudgeTarget, candidates: JudgeCandidate[]): Map<string, Judgement> {
  const out = new Map<string, Judgement>();
  const byId = new Map<number, any>();
  for (const j of Array.isArray(raw?.judgements) ? raw.judgements : []) {
    const id = Number(j?.id);
    if (Number.isInteger(id) && !byId.has(id)) byId.set(id, j);
  }
  candidates.forEach((c, i) => {
    const j = byId.get(i + 1);
    let verdict: Verdict = j && ['yes', 'no', 'unsure'].includes(j.verdict) ? j.verdict : 'unsure';
    let reason = clip(j?.reason, 120) || (j ? '' : 'not judged');
    // Google's own data wins: the target's exact specific category is never "different trade".
    if (verdict === 'no' && sharesSpecificCategory(target, c)) {
      verdict = 'unsure';
      reason = `same Google category "${target.primaryCategory}" (AI said: ${reason || 'different'})`;
    }
    out.set(c.key, { verdict, reason });
  });
  return out;
}

export interface SavedJudgement {
  hash: string;
  createdAt: string;
  judgements: Record<string, Judgement>;
}

/**
 * Judge the candidates (or reuse the saved result for the same target and
 * the same list). Never throws: AI off or failing → `judgements: null`, and
 * the caller keeps the rule-based result.
 */
export async function judgeCompetitors(
  target: JudgeTarget,
  candidates: JudgeCandidate[],
  opts: { saved?: SavedJudgement | null; now?: Date } = {},
): Promise<{ judgements: Map<string, Judgement> | null; saved: SavedJudgement | null; reused: boolean; error: string | null }> {
  const now = opts.now ?? new Date();
  const list = candidates.slice(0, MAX_JUDGED);
  if (!list.length) return { judgements: new Map(), saved: null, reused: false, error: null };
  const hash = judgeHash(target, list);
  const s = opts.saved;
  if (s?.hash === hash && now.getTime() - new Date(s.createdAt).getTime() < JUDGE_TTL_MS) {
    return { judgements: new Map(Object.entries(s.judgements)), saved: s, reused: true, error: null };
  }
  if (!process.env.GROQ_API_KEY) return { judgements: null, saved: null, reused: false, error: 'GROQ_API_KEY not set' };
  try {
    const Groq = (await import('groq-sdk')).default;
    const { GROQ_MODEL } = await import('@/lib/aiModel');
    const { withGroqRetry } = await import('@/lib/groqRetry');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 });
    const res: any = await withGroqRetry(() => groq.chat.completions.create({
      model: process.env.FREE_REPORT_AI_MODEL || GROQ_MODEL,
      messages: [{ role: 'user', content: judgePrompt(target, list) }],
      temperature: 0,
      response_format: { type: 'json_object' },
      reasoning_effort: 'low',
    } as any, { timeout: 15_000 }), { reason: 'competitor_judge', retries: 1, maxWaitMs: 5_000 });
    const content = res?.choices?.[0]?.message?.content;
    const judgements = parseJudgements(content ? JSON.parse(content) : null, target, list);
    const saved: SavedJudgement = { hash, createdAt: now.toISOString(), judgements: Object.fromEntries(judgements) };
    return { judgements, saved, reused: false, error: null };
  } catch (err: any) {
    return { judgements: null, saved: null, reused: false, error: String(err?.message || err).slice(0, 200) };
  }
}
