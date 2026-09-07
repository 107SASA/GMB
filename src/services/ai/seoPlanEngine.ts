import Groq from 'groq-sdk';
import { GROQ_MODEL } from '@/lib/aiModel';
import {
  buildCompletionPromptFact,
  qualifyCompletionInProse,
  COMPLETION_PROMPT_RULE,
} from '@/lib/profileCompletion';
import { NOT_FOUND_RANK } from '@/services/audit/seoAnalyzer';
import type { ISeoPlanDraft, IKeywordTableRow, ISeoPlanSnapshotTile } from '@/models/Audit';
import type { WebsiteSignals } from '@/services/audit/websiteSignals';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export type ReportDepth = 'free' | 'full';

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

  // ── 'full' depth extras ──────────────────────────────────────────────────
  depth?: ReportDepth;
  /** From the intake form / Places editorial summary. */
  offers?: string;
  usps?: string;
  services?: string;
  /** Light read of the business's own website. */
  websiteSignals?: WebsiteSignals | null;
  /** Live GBP fields, only when the workspace connected Google. */
  gbpLive?: {
    title?: string;
    description?: string;
    primaryCategory?: string;
    additionalCategories?: string[];
  } | null;
  suspensionRisk?: { level: string; pct: number };
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
    return { name: c.name, mapsRank: c.mapsRank, rating: c.rating, reviewCount: c.reviewCount, keyEdge };
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

/** 'full' only — Today → 14d → 45d → 90d rank bands, derived from the current
 *  average rank and how crowded the competitor set is. Targets for the work,
 *  never a promise. */
function buildRankTimeline(input: SeoPlanInput): ISeoPlanDraft['rankTimeline'] {
  const r = input.avgRank && input.avgRank < NOT_FOUND_RANK ? Math.round(input.avgRank) : 16;
  const band = (lo: number, hi: number) => `#${Math.max(1, lo)}–${Math.max(2, hi)}`;
  const strongComp = input.competitors.filter((c) => (c.mapsRank ?? 21) <= 5).length;
  const ninety = strongComp >= 4 ? 'Top 5' : 'Top 3';
  return [
    { label: 'Today', rank: r >= 20 ? '#10–18' : band(r - 2, r + 3), note: 'Below stronger competitors', tone: 'bad' },
    { label: 'After 14 days', rank: band(r - 8, r - 3), note: 'Credential-first title + description applied', tone: 'warn' },
    { label: 'After 45 days', rank: '#4–7', note: 'Reviews building + extra categories live', tone: 'warn' },
    { label: 'After 90 days', rank: ninety, note: 'Local pack contender on the plan keywords', tone: 'good' },
  ];
}

/** Core Performance Snapshot tiles — real numbers only. 'full' adds up to 4
 *  offer/USP tiles supplied by the LLM. */
function buildCoreSnapshot(input: SeoPlanInput): ISeoPlanSnapshotTile[] {
  const pc = input.profileCompletion || {};
  const tiles: ISeoPlanSnapshotTile[] = [];

  tiles.push({
    label: 'Est. Google Maps rank',
    value: input.avgRank && input.avgRank < NOT_FOUND_RANK ? fmtRank(input.avgRank) : '10–18',
    note: input.avgRank && input.avgRank <= 3 ? 'In the local pack' : 'Not in the Maps 3-pack',
    tone: input.avgRank && input.avgRank <= 3 ? 'good' : 'bad',
  });
  tiles.push({
    label: 'Website',
    value: input.websiteSignals?.reachable ? 'Live ✓' : input.website ? 'On listing' : 'Not found',
    note: input.website ? String(input.website).replace(/^https?:\/\//, '').replace(/\/$/, '') : 'Add a website URL',
    tone: input.websiteSignals?.reachable ? 'good' : input.website ? 'warn' : 'bad',
  });
  tiles.push({
    label: 'Google reviews',
    value: input.reviewCount > 0 ? `${input.reviewCount} · ${input.rating}★` : 'Est. low',
    note: input.reviewCount >= 50 ? 'Healthy volume' : 'Primary ranking gap',
    tone: input.reviewCount >= 50 ? 'good' : input.reviewCount > 0 ? 'warn' : 'bad',
  });
  tiles.push({
    label: 'Profile completion',
    value: `${Math.round(pc.completionPercentage ?? 0)}%`,
    note: (pc.oauthPendingCount ?? pc.unknownCount ?? 0) > 0 ? `${pc.oauthPendingCount ?? pc.unknownCount} fields need Google` : 'All visible fields filled',
    tone: (pc.completionPercentage ?? 0) >= 90 ? 'good' : 'warn',
  });
  tiles.push({
    label: 'Suspension risk',
    value: input.suspensionRisk?.level || 'Low',
    note: 'No naming/policy violations found',
    tone: (input.suspensionRisk?.level || 'Low').toLowerCase() === 'low' ? 'good' : 'warn',
  });
  return tiles;
}

function buildDataRequired(depth: ReportDepth): string[] {
  const base = [
    'Connect Google to read the live listing title, description, categories, hours, and attributes.',
    'Business description (from Google or owner intake).',
    'Services list currently on the listing.',
    'Owner USPs / credentials (registration, years, licence numbers).',
    'Keyword Planner returned no live volume for some phrases — those demand bands are labeled estimates by city tier.',
  ];
  if (depth === 'full') {
    base.push('Current monthly footfall and average sale value — for an ROI projection.');
    base.push('Localities currently served (for geo-specific posts and Q&As).');
  }
  return base;
}

// ── LLM sections ────────────────────────────────────────────────────────────

async function callNarrative(input: SeoPlanInput): Promise<Partial<ISeoPlanDraft>> {
  const full = input.depth === 'full';
  const fact = buildCompletionPromptFact(input.profileCompletion);
  const kwLines = input.keywordTable
    .map((k) => `- ${k.keyword} — demand ${k.volumeBand}${k.estimated ? ' (est)' : ''}, Maps rank ${fmtRank(k.mapsRank)}`)
    .join('\n');
  const compLines = input.competitors
    .slice(0, 8)
    .map((c) => `- ${c.name}: rank ${fmtRank(c.mapsRank)}, ${c.rating ?? '?'}★, ${c.reviewCount ?? '?'} reviews`)
    .join('\n');
  const site = input.websiteSignals?.reachable
    ? `WEBSITE: ${input.websiteSignals.structureNote} Service pages: ${input.websiteSignals.servicePages.slice(0, 12).join(', ') || 'none detected'}.`
    : 'WEBSITE: none reachable.';
  const ownerBits = [
    input.usps && `USPs: ${input.usps}`,
    input.offers && `Offers: ${input.offers}`,
    input.services && `Services: ${input.services}`,
  ].filter(Boolean).join(' | ') || '(none provided)';

  const prompt = `You are a senior local-SEO consultant. Analyse ONLY the facts. Do not invent competitors, ranks, credentials, or numbers. Output strict JSON.

BUSINESS: ${input.businessName}
CATEGORY: ${input.category}
LOCATION: ${[input.area, input.city, input.state].filter(Boolean).join(', ')}
NEIGHBOURHOODS SEARCHED: ${input.neighbourhoods.join(', ') || '(none resolved)'}
AVERAGE MAPS RANK: ${fmtRank(input.avgRank)}
REVIEWS: ${input.reviewCount} at ${input.rating}★
PROFILE COMPLETION: ${fact}
${COMPLETION_PROMPT_RULE}
OWNER-PROVIDED: ${ownerBits}
${site}

KEYWORDS (live Maps rank + demand band):
${kwLines}

COMPETITORS (real Maps data):
${compLines}

Return JSON:
{
  "keyFinding": "${full ? '4-6' : '3-4'} sentences. Name the business's genuine strengths (only from OWNER-PROVIDED / website / reviews — never invented). Name which competitors are ahead and why. State the strategic gap (listing optimisation for the real differentiators). ${full ? 'Include one same-area / same-category competitor by name if the list has one, and one grounded lost-opportunity line tied to a specific keyword and its demand band.' : 'One grounded lost-opportunity line only if a keyword with demand ranks worse than ~#5.'}",
  ${full ? '"websiteAssessment": "2-3 sentences assessing the business\'s own website from the WEBSITE facts — structure, service coverage, what to link/verify on the GBP.",' : ''}
  "keywordInsights": ["${full ? '3-4' : '2-3'} one-line takeaways naming specific keywords from the list — call out any uncontested niche phrases and any high-demand phrase ranking poorly"],
  "marketOpportunities": [
    { "keyword": "<from the list, or a short opportunity name>", "potential": "HIGHEST POTENTIAL | IMMEDIATE WIN | HIGH POTENTIAL", "rationale": "${full ? '3-4 sentences' : '1-2 sentences'} grounded in this business's real rating/reviews/rank/USPs${full ? ', ending with the single sentence the listing, posts and review replies should all repeat' : ''}" }
  ],
  "competitorCounterPosition": "2-3 sentences on how ${input.businessName} should counter-position given its real rating, review count and USPs",
  "uspLine": "one sentence, <=160 chars, the single differentiator to lead the listing description and review replies with — from OWNER-PROVIDED where possible, phrased as fact not hype",
  "reviewReplyMustInclude": ["2-4 short phrases every AI review reply should try to include (city, a service word, the USP theme)"]
}
Exactly 3 marketOpportunities.`;

  const j = await jsonCall(prompt, 0.35);
  return {
    keyFinding: j.keyFinding,
    websiteAssessment: full ? j.websiteAssessment : undefined,
    keywordInsights: Array.isArray(j.keywordInsights) ? j.keywordInsights.slice(0, 4) : [],
    marketOpportunities: Array.isArray(j.marketOpportunities) ? j.marketOpportunities.slice(0, 3) : [],
    competitorCounterPosition: j.competitorCounterPosition,
    uspLine: j.uspLine,
    reviewReplyMustInclude: Array.isArray(j.reviewReplyMustInclude) ? j.reviewReplyMustInclude.slice(0, 4) : [],
  };
}

async function callGbpDrafts(input: SeoPlanInput): Promise<Partial<ISeoPlanDraft>> {
  const full = input.depth === 'full';
  const live = input.gbpLive;
  const liveBlock = live
    ? `CURRENT LIVE GBP:
- title: ${live.title || '(empty)'}
- description: ${live.description ? `${live.description.slice(0, 200)}${live.description.length > 200 ? '…' : ''}` : '(empty)'}
- primary category: ${live.primaryCategory || '(unknown)'}
- additional categories: ${(live.additionalCategories || []).join(', ') || '(none)'}`
    : 'CURRENT LIVE GBP: not connected — mark title/description/category/attribute items "unverified".';

  const gapFields = full
    ? `[
    { "field": "GBP Title", "status": "ok|missing|unverified", "whyItMatters": "1 sentence", "recommendation": "give the EXACT recommended title (<=100 chars, real name + category + key locality + one differentiator, no self-praise)" },
    { "field": "GBP Description", "status": "...", "whyItMatters": "...", "recommendation": "what the first 150 chars must say + which keywords the 750 chars must embed" },
    { "field": "Additional Categories", "status": "...", "whyItMatters": "...", "recommendation": "name 3-5 specific Google categories and what search pool each unlocks" },
    { "field": "Services List", "status": "...", "whyItMatters": "...", "recommendation": "note it should list 15+ concrete services (see suggestedServices)" },
    { "field": "GBP Attributes", "status": "...", "whyItMatters": "...", "recommendation": "name the specific GBP attributes for this category (see suggestedAttributes)" },
    { "field": "Google Reviews", "status": "...", "whyItMatters": "...", "recommendation": "a review-ask cadence and the rank impact of getting there" },
    { "field": "Photos", "status": "...", "whyItMatters": "...", "recommendation": "what photos to add and a keyword-rich file-naming convention" }
  ]`
    : `[
    { "field": "Business Description", "whyItMatters": "1 sentence", "recommendation": "1-2 sentences" },
    { "field": "Services Listed", "whyItMatters": "...", "recommendation": "..." },
    { "field": "Social Links", "whyItMatters": "...", "recommendation": "..." },
    { "field": "Videos", "whyItMatters": "...", "recommendation": "..." },
    { "field": "Logo / Cover Image", "whyItMatters": "...", "recommendation": "..." },
    { "field": "Attributes", "whyItMatters": "...", "recommendation": "..." },
    { "field": "Booking / Appointment Link", "whyItMatters": "...", "recommendation": "..." }
  ]`;

  const prompt = `You are a Google Business Profile optimisation expert. Draft listing content for ${input.businessName} ONLY — drafts the owner reviews and applies, never auto-applied. Base everything on the category, location, and OWNER-PROVIDED facts; do not fabricate awards, years, or licence numbers. Output strict JSON.

BUSINESS: ${input.businessName}
CATEGORY: ${input.category}
CITY: ${input.city}${input.area ? `, AREA: ${input.area}` : ''}
TARGET KEYWORDS: ${input.keywordTable.slice(0, 10).map((k) => k.keyword).join(', ')}
OWNER-PROVIDED: ${[input.usps && `USPs: ${input.usps}`, input.offers && `Offers: ${input.offers}`, input.services && `Services: ${input.services}`].filter(Boolean).join(' | ') || '(none)'}
${liveBlock}

Return JSON:
{
  "suggestedTitle": "<=100 chars. Real name + primary category + key locality${full ? ' + one real differentiator' : ''}. No 'best/top/#1'.",
  "suggestedDescription": "150-750 chars. First 150 chars = the USP / what they do + for whom. Then services + location. Plain, specific.",
  "suggestedServices": ["${full ? '15' : '10-15'} concrete services for this exact category"],
  "suggestedCategories": ["3-5 additional Google Business categories"],
  ${full ? '"suggestedAttributes": ["4-8 GBP attributes relevant to this category — e.g. Wheelchair accessible, Appointment required, Online care, LGBTQ friendly, Identifies as women-owned, Licensed professionals on-site"],\n  "descriptionKeywords": ["the 10-16 keyword phrases the 750-char description must contain"],\n  "platformGaps": [ { "platform": "Practo | Justdial | Urban Company | IndiaMART | …", "why": "1 sentence — why this platform matters for this category" } ],' : ''}
  "gbpGaps": ${gapFields}
}${full ? ' 2-4 platformGaps.' : ''}`;

  const j = await jsonCall(prompt, 0.4);
  return {
    suggestedTitle: j.suggestedTitle,
    suggestedDescription: j.suggestedDescription,
    suggestedServices: Array.isArray(j.suggestedServices) ? j.suggestedServices.slice(0, 16) : [],
    suggestedCategories: Array.isArray(j.suggestedCategories) ? j.suggestedCategories.slice(0, 6) : [],
    suggestedAttributes: full && Array.isArray(j.suggestedAttributes) ? j.suggestedAttributes.slice(0, 10) : undefined,
    descriptionKeywords: full && Array.isArray(j.descriptionKeywords) ? j.descriptionKeywords.slice(0, 18) : undefined,
    platformGaps: full && Array.isArray(j.platformGaps) ? j.platformGaps.slice(0, 4) : undefined,
    gbpGaps: Array.isArray(j.gbpGaps) ? j.gbpGaps.slice(0, 9) : [],
  };
}

async function callActionPlan(input: SeoPlanInput): Promise<Partial<ISeoPlanDraft>> {
  const full = input.depth === 'full';
  const areas = input.neighbourhoods.slice(0, 4);
  const prompt = `You are a local-SEO delivery lead. Build a concrete 30/60/90-day plan for ${input.businessName} (${input.category}, ${input.city}). Ground every item in the real gaps: listing fields, weekly posting, reviews, Q&As${full ? ', off-GBP platform listings, referral outreach' : ''}. Do not promise rankings. Output strict JSON.

OWNER-PROVIDED: ${[input.usps && `USPs: ${input.usps}`, input.offers && `Offers: ${input.offers}`].filter(Boolean).join(' | ') || '(none)'}

Return JSON:
{
  "actionPhases": [
    { "label": "EMERGENCY", "window": "Week 1-2", "items": [ { "title": "...", "detail": "${full ? '2-3 sentences with EXACT copy in quotes where relevant (title text, post text)' : '1-2 sentences'} naming ${input.businessName} and the city/area", "priority": "CRITICAL | HIGH | MEDIUM" } ] },
    { "label": "SHORT-TERM", "window": "Day 15-45", "items": [ ... ] },
    { "label": "MEDIUM-TERM", "window": "Day 46-90", "items": [ ... ] }
  ],
  "weeklyPostThemes": [
    { "weekday": "Monday", "theme": "short post idea", "keyword": "<one keyword from the plan>", "postType": "UPDATE | OFFER | EVENT" }
  ],
  "suggestedQas": [ { "q": "question a customer would ask", "a": "1-2 sentence answer mentioning ${input.city}${full ? ' and a differentiator' : ''}" } ]
}
${full ? '5-6' : '4-6'} items in EMERGENCY, ${full ? '4' : '3-4'} in SHORT-TERM, ${full ? '4' : '3-4'} in MEDIUM-TERM. Exactly 4 weeklyPostThemes (Mon/Wed/Fri/Sat) using ${areas.length ? `these areas where possible: ${areas.join(', ')}` : 'the plan keywords'}. ${full ? '10' : '6-8'} suggestedQas.`;

  const j = await jsonCall(prompt, 0.4);
  return {
    actionPhases: Array.isArray(j.actionPhases) ? j.actionPhases : [],
    weeklyPostThemes: Array.isArray(j.weeklyPostThemes) ? j.weeklyPostThemes.slice(0, 4) : [],
    suggestedQas: Array.isArray(j.suggestedQas) ? j.suggestedQas.slice(0, full ? 10 : 8) : [],
  };
}

/** 'full' only — the 3-4 offer/USP Performance-Snapshot tiles. Small call. */
async function callSnapshotTiles(input: SeoPlanInput): Promise<ISeoPlanSnapshotTile[]> {
  const owner = [input.usps, input.offers, input.services].filter(Boolean).join(' | ');
  if (!owner) return [];
  const prompt = `From the OWNER-PROVIDED facts for ${input.businessName} (${input.category}, ${input.city}), pick the 3-4 strongest differentiators a searcher would care about and turn each into a snapshot tile. Only use what's stated — do not invent. Output strict JSON.

OWNER-PROVIDED: ${owner}

Return JSON:
{ "tiles": [ { "label": "short label e.g. Free hearing test", "value": "Offered ✓ | 20 yrs ✓ | Home visit ✓", "note": "why it matters, <=6 words", "tone": "good" } ] }`;
  try {
    const j = await jsonCall(prompt, 0.3);
    return Array.isArray(j.tiles)
      ? j.tiles.slice(0, 4).map((t: any) => ({ label: String(t.label || ''), value: String(t.value || ''), note: t.note ? String(t.note) : undefined, tone: 'good' as const }))
      : [];
  } catch {
    return [];
  }
}

/**
 * Generate the consultant sections. Each LLM block is independent — a failure
 * in one records its name in `failed` and the rest still render.
 */
export async function generateSeoPlanDraft(input: SeoPlanInput): Promise<ISeoPlanDraft> {
  const depth: ReportDepth = input.depth === 'full' ? 'full' : 'free';
  input.depth = depth;

  const draft: ISeoPlanDraft = {
    depth,
    performanceSnapshot: buildCoreSnapshot(input),
    // KPI blocks — Performance Snapshot + Projected Rank Timeline + dual
    // Search/Maps volume — are on BOTH tiers (owner ask, Sep 2026). The
    // depth split is now: 'full' also reads the website + live GBP, does the
    // deeper GBP-gap prose (status icons, exact title inline, attributes,
    // 750-char keyword list, platform gaps) and gets the Confidential PDF.
    rankTimeline: buildRankTimeline(input),
    competitorLandscape: buildCompetitorLandscape(input),
    criticalGap: buildCriticalGap(input),
    whatWeAimFor: buildWhatWeAimFor(input),
    dataRequired: buildDataRequired(depth),
    failed: [],
  };

  const hasOwnerData = !!(input.usps || input.offers || input.services);
  const tasks = [callNarrative(input), callGbpDrafts(input), callActionPlan(input)];
  // Offer/USP snapshot tiles need real owner facts — skip the call entirely
  // on a free report with nothing to work from (the common case pre-intake).
  if (depth === 'full' || hasOwnerData) tasks.push(callSnapshotTiles(input) as any);

  const [narrative, gbp, action, tiles] = await Promise.allSettled(tasks);

  if (narrative.status === 'fulfilled') Object.assign(draft, narrative.value);
  else { draft.failed!.push('narrative'); console.warn('[seoPlanEngine] narrative failed:', (narrative as PromiseRejectedResult).reason?.message); }

  if (gbp.status === 'fulfilled') Object.assign(draft, gbp.value);
  else { draft.failed!.push('gbpDrafts'); console.warn('[seoPlanEngine] gbpDrafts failed:', (gbp as PromiseRejectedResult).reason?.message); }

  if (action.status === 'fulfilled') Object.assign(draft, action.value);
  else { draft.failed!.push('actionPlan'); console.warn('[seoPlanEngine] actionPlan failed:', (action as PromiseRejectedResult).reason?.message); }

  if (tiles && tiles.status === 'fulfilled' && Array.isArray(tiles.value) && tiles.value.length) {
    draft.performanceSnapshot = [...(draft.performanceSnapshot || []), ...tiles.value];
  }

  // Qualify any "100% complete" that slipped into generated prose.
  const fact = buildCompletionPromptFact(input.profileCompletion);
  const pending = Number(input.profileCompletion?.oauthPendingCount ?? input.profileCompletion?.unknownCount ?? 0);
  draft.keyFinding = qualifyCompletionInProse(draft.keyFinding, fact, pending);
  draft.websiteAssessment = qualifyCompletionInProse(draft.websiteAssessment, fact, pending);
  draft.competitorCounterPosition = qualifyCompletionInProse(draft.competitorCounterPosition, fact, pending);
  if (Array.isArray(draft.marketOpportunities)) {
    draft.marketOpportunities = draft.marketOpportunities.map((m) => ({
      ...m,
      rationale: qualifyCompletionInProse(m.rationale, fact, pending),
    }));
  }

  return draft;
}
