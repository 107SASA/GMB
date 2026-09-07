import Groq from 'groq-sdk';
import { GROQ_MODEL } from '@/lib/aiModel';
import {
  buildCompletionPromptFact,
  qualifyCompletionInProse,
  COMPLETION_PROMPT_RULE,
} from '@/lib/profileCompletion';
import { NOT_FOUND_RANK } from '@/services/audit/seoAnalyzer';
import type { ISeoPlanDraft, IKeywordTableRow } from '@/models/Audit';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface SeoPlanInput {
  businessName: string;
  category: string;
  city: string;
  area?: string;
  state?: string;
  country?: string;
  website?: string;
  neighbourhoods: string[];
  primaryKeyword: string;
  keywordTable: IKeywordTableRow[];
  competitors: Array<{ name: string; mapsRank?: number; rating?: number; reviewCount?: number }>;
  avgRank: number;
  reviewCount: number;
  rating: number;
  profileCompletion: any;
  strengths?: any[];
  weaknesses?: any[];
}

const fmtRank = (r?: number) =>
  r == null ? 'not ranked' : r >= NOT_FOUND_RANK ? '20+' : `#${Math.round(r)}`;

async function jsonCall(prompt: string, temperature = 0.3): Promise<any> {
  const res = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature,
  });
  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error('empty Groq response');
  return JSON.parse(content);
}

// ── Deterministic sections (no LLM — built straight from real numbers) ────────

function buildCompetitorLandscape(input: SeoPlanInput): ISeoPlanDraft['competitorLandscape'] {
  return input.competitors.slice(0, 10).map((c) => {
    const bits: string[] = [];
    if (c.mapsRank != null) bits.push(`an average local rank of ${c.mapsRank >= NOT_FOUND_RANK ? '20+' : c.mapsRank}`);
    if (c.rating != null) bits.push(`a ${c.rating}-star rating`);
    if (c.reviewCount != null) bits.push(`${c.reviewCount} reviews`);
    const keyEdge = bits.length
      ? `${c.name} holds ${bits.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`
      : `${c.name} is an established local competitor.`;
    return {
      name: c.name,
      mapsRank: c.mapsRank,
      rating: c.rating,
      reviewCount: c.reviewCount,
      keyEdge,
    };
  });
}

function buildCriticalGap(input: SeoPlanInput): ISeoPlanDraft['criticalGap'] {
  const weak = input.keywordTable
    .filter((k) => k.mapsRank == null || k.mapsRank > 5)
    .slice(0, 5)
    .map((k) => ({ keyword: k.keyword, mapsRank: k.mapsRank }));
  return {
    intro: `When people look for these phrases near ${input.city || 'your area'}, ${input.businessName} is not in a strong Maps position. Those clicks go to whoever shows first.`,
    rows: weak,
    closer: `The answer is to put this listing's real differentiators on the title and description — not to invent a new business.`,
  };
}

function buildWhatWeAimFor(input: SeoPlanInput): ISeoPlanDraft['whatWeAimFor'] {
  return {
    todayRank: fmtRank(input.avgRank),
    milestones: [
      { label: 'After 14 days', text: 'Apply the recommended title, description, services, and extra categories on the live listing.' },
      { label: 'After 30 days', text: 'Keep weekly posts on the plan keywords, seed Q&As, and start review asks after real jobs.' },
      { label: 'After 90 days', text: 'Re-audit, compare against this baseline, and refresh the plan version from new ranks and reviews.' },
    ],
  };
}

function buildDataRequired(): string[] {
  return [
    'Connect Google to read the live listing title, description, categories, hours, and attributes.',
    'Business description (from Google or owner intake).',
    'Services list currently on the listing.',
    'Owner USPs / credentials (registration, years, offers).',
    'Keyword Planner returned no live volume for some phrases — those demand bands are labeled estimates by city tier.',
  ];
}

// ── LLM sections ────────────────────────────────────────────────────────────

async function callNarrative(input: SeoPlanInput): Promise<Partial<ISeoPlanDraft>> {
  const fact = buildCompletionPromptFact(input.profileCompletion);
  const kwLines = input.keywordTable
    .map((k) => `- ${k.keyword} — demand ${k.volumeBand}${k.estimated ? ' (est)' : ''}, Maps rank ${fmtRank(k.mapsRank)}`)
    .join('\n');
  const compLines = input.competitors
    .slice(0, 8)
    .map((c) => `- ${c.name}: rank ${fmtRank(c.mapsRank)}, ${c.rating ?? '?'}★, ${c.reviewCount ?? '?'} reviews`)
    .join('\n');

  const prompt = `You are a senior local-SEO consultant. Analyse ONLY the facts. Do not invent competitors, ranks, or numbers. Output strict JSON.

BUSINESS: ${input.businessName}
CATEGORY: ${input.category}
LOCATION: ${[input.area, input.city, input.state].filter(Boolean).join(', ')}
NEIGHBOURHOODS SEARCHED: ${input.neighbourhoods.join(', ') || '(none resolved)'}
AVERAGE MAPS RANK: ${fmtRank(input.avgRank)}
REVIEWS: ${input.reviewCount} at ${input.rating}★
PROFILE COMPLETION: ${fact}
${COMPLETION_PROMPT_RULE}

KEYWORDS (live Maps rank + demand band):
${kwLines}

COMPETITORS (real Maps data):
${compLines}

Return JSON:
{
  "keyFinding": "3-4 sentences. What the business has going for it, why it still isn't ranking (listing optimisation gap), which competitors are ahead and why, and one grounded lost-opportunity line ONLY if a keyword with real/estimated demand ranks worse than ~#5.",
  "keywordInsights": ["2-3 one-line takeaways naming specific keywords from the list above"],
  "marketOpportunities": [
    { "keyword": "<from the list>", "potential": "HIGHEST POTENTIAL | IMMEDIATE WIN | HIGH POTENTIAL", "rationale": "1-2 sentences grounded in this business's rating/reviews/rank" }
  ],
  "competitorCounterPosition": "2-3 sentences on how ${input.businessName} should counter-position given its real rating and review count",
  "uspLine": "one sentence, <=160 chars, the single differentiator to lead the listing description and review replies with — inferred from category + location, phrased as fact not hype",
  "reviewReplyMustInclude": ["2-4 short phrases every AI review reply should try to include (city, a service word, the USP theme)"]
}
Exactly 3 marketOpportunities.`;

  const j = await jsonCall(prompt, 0.35);
  return {
    keyFinding: j.keyFinding,
    keywordInsights: Array.isArray(j.keywordInsights) ? j.keywordInsights.slice(0, 4) : [],
    marketOpportunities: Array.isArray(j.marketOpportunities) ? j.marketOpportunities.slice(0, 3) : [],
    competitorCounterPosition: j.competitorCounterPosition,
    uspLine: j.uspLine,
    reviewReplyMustInclude: Array.isArray(j.reviewReplyMustInclude) ? j.reviewReplyMustInclude.slice(0, 4) : [],
  };
}

async function callGbpDrafts(input: SeoPlanInput): Promise<Partial<ISeoPlanDraft>> {
  const prompt = `You are a Google Business Profile optimisation expert. Draft listing content for ${input.businessName} ONLY — these are drafts the owner will review and apply after connecting Google, never auto-applied. Base everything on the category and location; do not fabricate awards, years in business, or specific credentials. Output strict JSON.

BUSINESS: ${input.businessName}
CATEGORY: ${input.category}
CITY: ${input.city}${input.area ? `, AREA: ${input.area}` : ''}
TARGET KEYWORDS: ${input.keywordTable.slice(0, 8).map((k) => k.keyword).join(', ')}

Return JSON:
{
  "suggestedTitle": "<=100 chars. Real business name + the primary category + the key locality. No 'best/top/#1' self-praise.",
  "suggestedDescription": "150-750 chars. First 150 chars MUST be the USP / what they do + for whom. Then coverage of services and location. Plain, specific, no hype.",
  "suggestedServices": ["10-15 concrete services typical for this exact category"],
  "suggestedCategories": ["3-5 additional Google Business categories to add"],
  "gbpGaps": [
    { "field": "Business Description", "whyItMatters": "1 sentence", "recommendation": "1-2 sentences, specific to this business" },
    { "field": "Services Listed", "whyItMatters": "...", "recommendation": "..." },
    { "field": "Social Links", "whyItMatters": "...", "recommendation": "..." },
    { "field": "Videos", "whyItMatters": "...", "recommendation": "..." },
    { "field": "Logo / Cover Image", "whyItMatters": "...", "recommendation": "..." },
    { "field": "Attributes", "whyItMatters": "...", "recommendation": "..." },
    { "field": "Booking / Appointment Link", "whyItMatters": "...", "recommendation": "..." }
  ]
}`;

  const j = await jsonCall(prompt, 0.4);
  return {
    suggestedTitle: j.suggestedTitle,
    suggestedDescription: j.suggestedDescription,
    suggestedServices: Array.isArray(j.suggestedServices) ? j.suggestedServices.slice(0, 15) : [],
    suggestedCategories: Array.isArray(j.suggestedCategories) ? j.suggestedCategories.slice(0, 6) : [],
    gbpGaps: Array.isArray(j.gbpGaps) ? j.gbpGaps.slice(0, 8) : [],
  };
}

async function callActionPlan(input: SeoPlanInput): Promise<Partial<ISeoPlanDraft>> {
  const areas = input.neighbourhoods.slice(0, 4);
  const prompt = `You are a local-SEO delivery lead. Build a concrete 30/60/90-day plan for ${input.businessName} (${input.category}, ${input.city}). Ground every item in the real gaps: profile listing fields, weekly posting, reviews, Q&As. Do not promise rankings. Output strict JSON.

Return JSON:
{
  "actionPhases": [
    { "label": "EMERGENCY", "window": "Week 1-2", "items": [ { "title": "...", "detail": "1-2 sentences naming ${input.businessName} and the city/area", "priority": "CRITICAL | HIGH | MEDIUM" } ] },
    { "label": "SHORT-TERM", "window": "Day 15-45", "items": [ ... ] },
    { "label": "MEDIUM-TERM", "window": "Day 46-90", "items": [ ... ] }
  ],
  "weeklyPostThemes": [
    { "weekday": "Monday", "theme": "short post idea", "keyword": "<one keyword from the plan>", "postType": "UPDATE | OFFER | EVENT" }
  ],
  "suggestedQas": [ { "q": "question a customer would ask", "a": "1-2 sentence answer mentioning ${input.city}" } ]
}
4-6 items in EMERGENCY, 3-4 in SHORT-TERM, 3-4 in MEDIUM-TERM. Exactly 4 weeklyPostThemes (Mon/Wed/Fri/Sat) using ${areas.length ? `these areas where possible: ${areas.join(', ')}` : 'the plan keywords'}. 6-8 suggestedQas.`;

  const j = await jsonCall(prompt, 0.4);
  return {
    actionPhases: Array.isArray(j.actionPhases) ? j.actionPhases : [],
    weeklyPostThemes: Array.isArray(j.weeklyPostThemes) ? j.weeklyPostThemes.slice(0, 4) : [],
    suggestedQas: Array.isArray(j.suggestedQas) ? j.suggestedQas.slice(0, 8) : [],
  };
}

/**
 * Generate the consultant sections. Each LLM block is independent — a failure
 * in one records its name in `failed` and the rest still render (the UI shows
 * a "couldn't be generated" note for just that block).
 */
export async function generateSeoPlanDraft(input: SeoPlanInput): Promise<ISeoPlanDraft> {
  const draft: ISeoPlanDraft = {
    competitorLandscape: buildCompetitorLandscape(input),
    criticalGap: buildCriticalGap(input),
    whatWeAimFor: buildWhatWeAimFor(input),
    dataRequired: buildDataRequired(),
    failed: [],
  };

  const [narrative, gbp, action] = await Promise.allSettled([
    callNarrative(input),
    callGbpDrafts(input),
    callActionPlan(input),
  ]);

  if (narrative.status === 'fulfilled') Object.assign(draft, narrative.value);
  else { draft.failed!.push('narrative'); console.warn('[seoPlanEngine] narrative failed:', (narrative as PromiseRejectedResult).reason?.message); }

  if (gbp.status === 'fulfilled') Object.assign(draft, gbp.value);
  else { draft.failed!.push('gbpDrafts'); console.warn('[seoPlanEngine] gbpDrafts failed:', (gbp as PromiseRejectedResult).reason?.message); }

  if (action.status === 'fulfilled') Object.assign(draft, action.value);
  else { draft.failed!.push('actionPlan'); console.warn('[seoPlanEngine] actionPlan failed:', (action as PromiseRejectedResult).reason?.message); }

  // Qualify any "100% complete" that slipped into the narrative prose.
  const fact = buildCompletionPromptFact(input.profileCompletion);
  const pending = Number(input.profileCompletion?.oauthPendingCount ?? input.profileCompletion?.unknownCount ?? 0);
  draft.keyFinding = qualifyCompletionInProse(draft.keyFinding, fact, pending);
  draft.competitorCounterPosition = qualifyCompletionInProse(draft.competitorCounterPosition, fact, pending);
  if (Array.isArray(draft.marketOpportunities)) {
    draft.marketOpportunities = draft.marketOpportunities.map((m) => ({
      ...m,
      rationale: qualifyCompletionInProse(m.rationale, fact, pending),
    }));
  }

  return draft;
}
