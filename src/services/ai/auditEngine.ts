import Groq from 'groq-sdk';
import { GROQ_MODEL } from '@/lib/aiModel';
import { withGroqRetry } from '@/lib/groqRetry';
import { qualifyCompletionInProse } from '@/lib/profileCompletion';
import { describeEvidence, GROWWMATICS_CAPABILITIES, type Evidence, type Finding } from '@/services/audit/findings';
import { allowedNumbersFrom, assertsGbpContent, claimsCausation, claimsFabricatedOutcome, claimsUnsupportedCapability, groundItems, groundText, inventedClaimChecker, type ClaimContext } from '@/services/audit/validateAudit';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface AuditEngineOptions {
  /** Feature 2B — Improvement Plan Duration selector (30 / 45 / 90 days). */
  actionPlanDurationDays?: 30 | 45 | 90;
}

/**
 * Per-duration instructions for the action plan (Feature 2B). Each bucket
 * produces a genuinely different plan — different cadence, different
 * number of periods, and a different strategic focus — not just a
 * relabeled heading on the same content.
 */
const ACTION_PLAN_SPECS: Record<30 | 45 | 90, {
  label: string;
  cadenceNoun: string;
  periodCount: number;
  periodLabels: string[];
  focus: string;
  extendedLabel: string;
  extendedFocus: string;
}> = {
  30: {
    label: '30-Day Action Plan',
    cadenceNoun: 'week',
    periodCount: 4,
    periodLabels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
    focus:
      'Prioritize ONLY the highest-impact, lowest-effort fixes and quick wins that can realistically be completed by one person in a single week each. Every task must be concrete and achievable within 7 days — no multi-week initiatives.',
    extendedLabel: 'Beyond 30 Days — Ongoing Roadmap',
    extendedFocus:
      'Summarize, at a high level, what should happen after the 30-day sprint to keep building toward full optimization (do not repeat the 30-day tasks).',
  },
  45: {
    label: '45-Day Action Plan',
    cadenceNoun: 'phase',
    periodCount: 3,
    periodLabels: ['Days 1-15', 'Days 16-30', 'Days 31-45'],
    focus:
      'Focus on MEDIUM-TERM improvements: reputation building (review generation & response cadence), content strategy (posting cadence, GBP content), and citation/NAP consistency improvements. These are initiatives that need 2+ weeks to show results, not one-day quick wins.',
    extendedLabel: 'Beyond 45 Days — Ongoing Roadmap',
    extendedFocus:
      'Summarize what should happen after day 45 to sustain the reputation and content gains and move toward full authority building.',
  },
  90: {
    label: '90-Day Roadmap',
    cadenceNoun: 'month',
    periodCount: 3,
    periodLabels: ['Month 1', 'Month 2', 'Month 3'],
    focus:
      'Build a COMPLETE optimization roadmap: authority building (backlinks/citations at scale), long-term reputation strategy, a sustained posting schedule, and structural profile growth. Each month should build on the last toward category-leading authority.',
    extendedLabel: 'Beyond 90 Days — Ongoing Roadmap',
    extendedFocus:
      'Summarize the ongoing maintenance cadence (posting, review responses, ranking checks) needed to sustain the gains after the 90-day roadmap ends.',
  },
};

/** Everything the AI is allowed to know. Numbers here are already computed —
 *  the AI interprets them; it never produces new ones. */
export interface AuditAIInput {
  business: { name: string; category: string; location: string; website?: string | null; tier?: string };
  /** Compact deterministic facts (ranking summaries, review facts, competitor
   *  comparison, profile field states, suspension-risk reasons). */
  facts: Record<string, unknown>;
  evidence: Evidence[];
  findings: Finding[];
  /** Real review text from synced reviews — empty when none was synced. */
  reviewTexts: Array<{ rating: number; text: string }>;
  profileCompletionFact: string;
  profileCompletionPending: number;
  /** The live Google Business Profile was read (connected audits only). */
  gbpRead?: boolean;
  /** Real business names, places and stated services AI text may mention. */
  claimContext?: ClaimContext;
}

export interface AuditAIResult {
  /** Per-finding AI judgement; ids always refer to real findings. */
  findingAssessments: Array<{ id: string; matters: boolean; priority: number; why: string; recommendedAction?: string }>;
  strengths: Array<{ title: string; observation?: string; evidence: string; evidenceIds: string[] }>;
  weaknesses: Array<{ title: string; observation?: string; evidence: string; evidenceIds: string[] }>;
  /** 'unknown' whenever no review text was available — never generated blind. */
  reviewThemes: { praises: string[]; complaints: string[] } | 'unknown';
  thirtyDayPlan: Array<{ week: string; tasks: string[]; expectedOutcome?: string }>;
  ninetyDayPlan: Array<{ month: string; tasks: string[]; focusAreas?: string[] }>;
  actionPlan: { durationDays: number; planLabel: string; extendedLabel: string };
  /** Items removed by the grounding guard (logged on auditData.validation). */
  groundingRepairs: string[];
  _usage: { promptTokens: number; completionTokens: number };
}

/**
 * The result used when the AI call fails: no strengths, weaknesses, themes or
 * plan text at all — never a written fallback. The report then shows its
 * deterministic facts and findings with an "AI analysis unavailable" note.
 */
export function emptyAIResult(durationDays: 30 | 45 | 90 = 30): AuditAIResult {
  const planSpec = ACTION_PLAN_SPECS[durationDays];
  return {
    findingAssessments: [],
    strengths: [],
    weaknesses: [],
    reviewThemes: 'unknown',
    thirtyDayPlan: [],
    ninetyDayPlan: [],
    actionPlan: { durationDays, planLabel: planSpec.label, extendedLabel: planSpec.extendedLabel },
    groundingRepairs: [],
    _usage: { promptTokens: 0, completionTokens: 0 },
  };
}

/** Claims a tiny review sample can't support, however high the rating. */
const REPUTATION_OVERCLAIM = /\b(established|strong|excellent|outstanding|trusted|proven)\s+(reputation|track record|brand)\b|\bmarket leader\b/i;

export async function generateAIAudit(input: AuditAIInput, options: AuditEngineOptions = {}): Promise<AuditAIResult> {
  const durationDays = options.actionPlanDurationDays ?? 30;
  const planSpec = ACTION_PLAN_SPECS[durationDays];

  const evidenceLines = input.evidence
    .filter((e) => e.status !== 'unknown')
    .map((e) => `- [${e.id}] ${describeEvidence(e)}`)
    .join('\n');
  const findingLines = input.findings
    .filter((f) => f.category !== 'data_quality')
    .map((f) => {
      const cap = f.growwmaticsCapability ? `GrowwMatics can help: ${GROWWMATICS_CAPABILITIES[f.growwmaticsCapability].label}` : 'GrowwMatics cannot do this directly';
      return `- {${f.id}} ${f.title} | evidence: ${f.evidence} | severity: ${f.severity} | ${f.actionability} | ${cap}`;
    })
    .join('\n');
  const reviews = input.reviewTexts.slice(0, 25).map((r) => `- (${r.rating}★) ${r.text.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  const hasReviewText = input.reviewTexts.length > 0;

  const prompt = `
You are a senior local-SEO analyst writing for the owner of ONE specific business. You interpret verified facts. You never add facts.

HARD RULES
1. Use ONLY the facts, evidence and findings below. Do not invent competitors, ratings, review counts, rankings, services, hours, offers, awards, years in business, search volumes or predictions.
2. Every strength and weakness MUST cite one or more evidence ids from the EVIDENCE list in "evidenceIds". Items without valid ids are discarded.
3. Do not use any number that is not in the facts. Do not claim that one fact CAUSES another (e.g. "ranks poorly because of few reviews") — describe comparisons, not causes.
4. A high rating from a very small number of reviews is an excellent current rating with a small sample — never an "established" or "strong" reputation.
5. A fact that could not be checked is unknown, not missing. Never describe unknown profile fields as gaps.${input.gbpRead ? '' : ' The Google Business Profile content (services, description, categories, attributes) was NOT read: never say it lacks or is missing something unless the EVIDENCE says "missing". Website evidence is what the website SAYS.'}
6. ${hasReviewText ? 'Review themes must come only from the REVIEW TEXT below.' : 'There is NO review text. Return "reviewThemes": "unknown".'}
7. Only say GrowwMatics can help where the finding says so.

BUSINESS: ${input.business.name} — ${input.business.category}, ${input.business.location}${input.business.tier ? ` (${input.business.tier})` : ''}
PROFILE COMPLETION: ${input.profileCompletionFact}

FACTS (JSON):
${JSON.stringify(input.facts)}

EVIDENCE:
${evidenceLines || '(none)'}

FINDINGS (verified candidate issues — you decide which matter most for THIS business):
${findingLines || '(none)'}

${hasReviewText ? `REVIEW TEXT (${input.reviewTexts.length} recent reviews):\n${reviews}\n` : ''}
TASK — return JSON:
{
  "findingAssessments": [ { "id": "<finding id>", "matters": true, "priority": 1, "why": "1-2 sentences on why this matters for this specific business, grounded in the evidence", "recommendedAction": "one concrete step" } ],
  "strengths": [ { "title": "...", "observation": "...", "evidenceIds": ["<evidence id>"] } ],
  "weaknesses": [ { "title": "...", "observation": "...", "evidenceIds": ["<evidence id>"] } ],
  "reviewThemes": ${hasReviewText ? '{ "praises": ["short theme"], "complaints": ["short theme"] }' : '"unknown"'},
  "thirtyDayPlan": [
${planSpec.periodLabels.map((p) => `    { "week": "${p}", "tasks": ["..."], "expectedOutcome": "an action outcome, never a ranking promise" }`).join(',\n')}
  ],
  "ninetyDayPlan": [ { "month": "${planSpec.extendedLabel}", "tasks": ["..."], "focusAreas": ["..."] } ]
}
- Assess EVERY finding id once. "priority" 1 = most important for this business. Set "matters": false for findings that are real but unimportant for this business.
- Strengths/weaknesses: as many as the evidence genuinely supports (0 is fine). Do not restate a neutral fact as a weakness.
- "thirtyDayPlan": exactly ${planSpec.periodCount} items using these period labels in order: ${JSON.stringify(planSpec.periodLabels)}. Focus: ${planSpec.focus} Tasks must address the findings that matter. Tasks must be realistic within one ${planSpec.cadenceNoun}.
- "ninetyDayPlan": exactly one item: ${planSpec.extendedFocus}
`;

  let response;
  try {
    response = await withGroqRetry(() => groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      reasoning_effort: 'low',
    }), { reason: 'audit_narrative' });
  } catch (error: any) {
    console.error('Error generating AI audit:', error);
    throw new Error(`Failed to generate AI audit: ${error.message || error}`);
  }

  const content = response.choices[0].message?.content;
  if (!content) throw new Error('No content returned from Groq AI');
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err: any) {
    throw new Error(`Failed to parse AI audit JSON: ${err.message}`);
  }

  return postProcessAIAudit(parsed, input, planSpec, durationDays, {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
  });
}

/** Grounding + shape enforcement. Exported for tests and for cached re-use. */
export function postProcessAIAudit(
  parsed: any,
  input: AuditAIInput,
  planSpec: { periodLabels: string[]; label: string; extendedLabel: string },
  durationDays: number,
  usage: { promptTokens: number; completionTokens: number },
): AuditAIResult {
  const repairs: string[] = [];
  const evidenceById = new Map(input.evidence.map((e) => [e.id, e]));
  const findingIds = new Set(input.findings.map((f) => f.id));
  const allowed = allowedNumbersFrom([input.facts, input.findings.map((f) => [f.title, f.evidence]), input.profileCompletionFact]);
  const qualify = (s: string) => qualifyCompletionInProse(s, input.profileCompletionFact, input.profileCompletionPending);
  const sampleSize = (input.facts as any)?.reviews?.lifetime?.sampleSize;
  const smallSample = sampleSize === 'none' || sampleSize === 'very_small' || sampleSize === 'small';

  const invented = input.claimContext ? inventedClaimChecker(input.claimContext) : null;
  const citeable = (list: any[], kind: string) => {
    const out: AuditAIResult['strengths'] = [];
    for (const item of Array.isArray(list) ? list : []) {
      const ids: string[] = (Array.isArray(item?.evidenceIds) ? item.evidenceIds : []).filter((id: string) => evidenceById.has(id));
      if (!item?.title || ids.length === 0) {
        repairs.push(`dropped ${kind} "${item?.title ?? '?'}" (no valid evidence ids)`);
        continue;
      }
      const title = qualify(String(item.title));
      const observation = item.observation ? qualify(String(item.observation)) : undefined;
      if (claimsCausation(`${title} ${observation ?? ''}`) || claimsFabricatedOutcome(`${title} ${observation ?? ''}`)) {
        repairs.push(`dropped ${kind} "${title}" (claims a cause of ranking)`);
        continue;
      }
      // "Services Not Reflected on GBP" when the GBP was never read: only a
      // verified-missing field (e.g. phone read from Google) can back that.
      const backedByVerifiedMissing = ids.some((id) => evidenceById.get(id)?.status === 'verified_missing');
      if (!input.gbpRead && !backedByVerifiedMissing && assertsGbpContent(`${title} ${observation ?? ''}`)) {
        repairs.push(`dropped ${kind} "${title}" (claims GBP content that was not read)`);
        continue;
      }
      const badSentence = invented ? (String(`${title}. ${observation ?? ''}`).match(/[^.!?]+[.!?]*/g) || []).find(invented) : undefined;
      if (badSentence) {
        repairs.push(`dropped ${kind} "${title}" (names a business or service not in the facts: "${badSentence.trim().slice(0, 90)}")`);
        continue;
      }
      if (smallSample && REPUTATION_OVERCLAIM.test(`${title} ${observation ?? ''}`)) {
        repairs.push(`dropped ${kind} "${title}" (reputation claim on a small review sample)`);
        continue;
      }
      out.push({ title, observation, evidenceIds: ids, evidence: ids.map((id) => describeEvidence(evidenceById.get(id)!)).join('; ') });
    }
    const g = groundItems(out as any[], ['title', 'observation'], allowed);
    g.dropped.forEach((d) => repairs.push(`dropped ${kind} ${d}`));
    return g.kept as AuditAIResult['strengths'];
  };

  const assessments = (Array.isArray(parsed?.findingAssessments) ? parsed.findingAssessments : [])
    .filter((a: any) => a && findingIds.has(a.id))
    .map((a: any, i: number) => ({
      id: String(a.id),
      matters: a.matters !== false,
      priority: Number.isFinite(Number(a.priority)) ? Number(a.priority) : i + 1,
      // A causal "why" (e.g. "contributing to lower rankings") is replaced by
      // the finding's own factual impact line (see below).
      why: claimsCausation(String(a.why || '')) || claimsFabricatedOutcome(String(a.why || '')) || (invented && invented(String(a.why || ''))) ? '' : qualify(String(a.why || '')),
      recommendedAction: a.recommendedAction && !claimsUnsupportedCapability(String(a.recommendedAction)) ? String(a.recommendedAction) : undefined,
    }));
  const groundedAssessments = groundItems(assessments as any[], ['why', 'recommendedAction'], allowed);
  groundedAssessments.dropped.forEach((d) => repairs.push(`dropped assessment ${d}`));

  let reviewThemes: AuditAIResult['reviewThemes'] = 'unknown';
  if (input.reviewTexts.length > 0 && parsed?.reviewThemes && typeof parsed.reviewThemes === 'object') {
    reviewThemes = {
      praises: (parsed.reviewThemes.praises || []).map(String).slice(0, 5),
      complaints: (parsed.reviewThemes.complaints || []).map(String).slice(0, 5),
    };
  } else if (parsed?.reviewThemes && parsed.reviewThemes !== 'unknown') {
    repairs.push('removed review themes generated without review text');
  }

  /** Plan text shown to customers: no causal claims, predicted outcomes, invented businesses/services or unread-GBP claims. */
  const planTextOk = (t: string, what: string) => {
    const reason = claimsCausation(t) ? 'claims a cause'
      : claimsFabricatedOutcome(t) ? 'predicts an outcome'
      : invented && (t.match(/[^.!?]+[.!?]*/g) || [t]).some(invented) ? 'names a business or service not in the facts'
      : !input.gbpRead && assertsGbpContent(t) ? 'claims GBP content that was not read'
      : null;
    if (reason) repairs.push(`dropped ${what} (${reason}): ${t.slice(0, 80)}`);
    return !reason;
  };
  const plan = (Array.isArray(parsed?.thirtyDayPlan) ? parsed.thirtyDayPlan : []).map((p: any, i: number) => {
    const tasks = groundItems((p?.tasks || []).map((t: any) => ({ t: String(t) })), ['t'], allowed);
    tasks.dropped.forEach((d) => repairs.push(`dropped plan task ${d}`));
    const kept = tasks.kept.map((x: any) => x.t).filter((t: string) => {
      const bad = claimsUnsupportedCapability(t);
      if (bad) repairs.push(`dropped plan task promising an unsupported GrowwMatics action: ${t.slice(0, 60)}`);
      return !bad && planTextOk(t, 'plan task');
    });
    // "Expected outcome" is shown to customers — it may describe the action's
    // result, never a predicted rank, number of calls/leads, or invented fact.
    const outcome = p?.expectedOutcome ? String(p.expectedOutcome) : undefined;
    const expectedOutcome = outcome && planTextOk(outcome, 'expected outcome') ? groundText(outcome, allowed) : undefined;
    return { week: planSpec.periodLabels[i] ?? String(p?.week ?? ''), tasks: kept, expectedOutcome };
  });
  const extended = (Array.isArray(parsed?.ninetyDayPlan) ? parsed.ninetyDayPlan : []).slice(0, 1).map((p: any) => ({
    month: planSpec.extendedLabel,
    tasks: groundItems((p?.tasks || []).map((t: any) => ({ t: String(t) })), ['t'], allowed).kept.map((x: any) => x.t)
      .filter((t: string) => !claimsUnsupportedCapability(t) && planTextOk(t, 'roadmap task')),
    focusAreas: Array.isArray(p?.focusAreas) ? p.focusAreas.map(String).filter((t: string) => planTextOk(t, 'focus area')) : undefined,
  }));

  return {
    findingAssessments: groundedAssessments.kept as AuditAIResult['findingAssessments'],
    strengths: citeable(parsed?.strengths, 'strength'),
    weaknesses: citeable(parsed?.weaknesses, 'weakness'),
    reviewThemes,
    // A period whose every task was removed by the guards is not shown empty.
    thirtyDayPlan: plan.filter((p: any) => p.tasks.length > 0),
    ninetyDayPlan: extended,
    actionPlan: { durationDays, planLabel: planSpec.label, extendedLabel: planSpec.extendedLabel },
    groundingRepairs: repairs,
    _usage: usage,
  };
}
