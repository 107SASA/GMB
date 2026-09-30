import Groq from 'groq-sdk';
import dbConnect from '@/lib/mongodb';
import { GROQ_MODEL } from '@/lib/aiModel';
import SalesAgentConfig from '@/models/SalesAgentConfig';
import type { ISalesConversation, ISalesScores } from '@/models/SalesConversation';
import { leadMessageFacts, leadMessageScores, resolveRankHeadline } from '@/services/audit/reportMath';
import {
  DEFAULT_FIRST_AI_PROMPT,
  DEFAULT_FIRST_TEMPLATE,
  DEFAULT_FOLLOWUPS,
  LEGACY_FIRST_AI_PROMPT,
  LEGACY_FIRST_TEMPLATE,
  LEGACY_FOLLOWUP_TEMPLATES,
  defaultSalesAgentConfig,
  renderTemplate,
  summariseKnowledge,
  type SalesAgentConfigShape,
  type SalesFollowUp,
} from '@/lib/salesAgentDefaults';
import { AGENT_SCOPE_GUARDRAIL } from '@/lib/agentGuardrails';
import { getBusinessNow } from '@/services/whatsapp-agent/dateTimeUtils';

/** Prepends the shared, code-level scope/safety floor — see agentGuardrails.ts. */
const withGuardrail = (persona: string) => `${AGENT_SCOPE_GUARDRAIL}\n\n${persona}`;

// GrowwMatics itself operates on IST — same default every other platform-side
// cron/agent in this codebase uses (see Business.ts's timezone default,
// businessHours.ts). Leads have no per-business timezone of their own here.
const PLATFORM_TIMEZONE = 'Asia/Kolkata';

const WEEKDAY_FULL: Record<string, string> = {
  Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
  Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday',
};

/** "Thursday, 21 Aug 2026, 11:42 PM IST" — grounds the model in the actual current moment. */
function currentTimeLine(): string {
  const now = getBusinessNow(PLATFORM_TIMEZONE);
  const weekday = WEEKDAY_FULL[now.weekday];
  const month = new Date(Date.UTC(now.year, now.month - 1, now.day))
    .toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });
  const h24 = now.hour;
  const period = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const time = `${h12}:${String(now.minute).padStart(2, '0')} ${period}`;
  return `Current date/time: ${weekday}, ${now.day} ${month} ${now.year}, ${time} IST.`;
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export function firstName(name?: string): string {
  const n = (name || '').trim().split(/\s+/)[0];
  return n || 'there';
}

function pct(n: unknown): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : null;
}

/** Pulls the numbers the messages reference out of a completed audit. */
export function extractScores(audit: any, business: any): ISalesScores {
  const d = audit?.auditData ?? {};
  // Rank/review previously read fields that never existed
  // (googleSearchRank.rank, profileScore.reviewScore), so leads were told
  // "rank 0" / "reviews 0%". See leadMessageScores in reportMath.ts.
  const headline = resolveRankHeadline(d);
  const lead = leadMessageScores(d);
  return {
    businessName: business?.name ?? audit?.businessName ?? 'your business',
    rank: headline.status === 'ok' && headline.value != null && headline.value <= 20 ? Math.round(headline.value * 10) / 10 : null,
    rankStatus: headline.status === 'ok' ? 'ok' : 'unavailable',
    profile: pct(d.profileScore?.profileCompletionScore ?? d.profileCompletion?.completionPercentage),
    seo: pct(d.seoScore?.score ?? d.profileScore?.seoScore),
    review: lead.review === 'n/a' ? null : Number(lead.review),
    ...(() => {
      const f = leadMessageFacts(d);
      return { rankText: f.rankText, profileText: f.profileText, seoText: f.seoText, reviewText: f.reviewText, verifiedIssues: f.issues };
    })(),
    competitor: d.competitors?.[0]?.name ?? d.localPackCompetitors?.[0]?.name ?? null,
    missingKeywords: (d.keywordGapAnalysis ?? [])
      .map((k: any) => k?.keyword)
      .filter((k: any): k is string => typeof k === 'string')
      .slice(0, 3),
  };
}

/** Loads the singleton config, creating it (with sensible URL defaults) once. */
export async function getSalesAgentConfig(): Promise<SalesAgentConfigShape> {
  await dbConnect();
  const existing = await SalesAgentConfig.findOne({ key: 'default' }).lean() as any;
  if (existing) {
    const base = defaultSalesAgentConfig();
    return {
      ...base,
      ...existing,
      firstMessage: { ...base.firstMessage, ...(existing.firstMessage ?? {}) },
      followUps: Array.isArray(existing.followUps) ? existing.followUps : base.followUps,
      // Existing configs predate the knowledge block — always hand callers a
      // real object so executor code can read config.knowledge.* unguarded.
      knowledge: { ...base.knowledge, ...(existing.knowledge ?? {}) },
    };
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const created = defaultSalesAgentConfig(
    appUrl ? `${appUrl}/dashboard/billing` : '',
    appUrl ? `${appUrl}/pricing` : ''
  );
  await SalesAgentConfig.create({ key: 'default', ...created });
  return created;
}

function buildVars(scores: ISalesScores, leadName: string, config: SalesAgentConfigShape): Record<string, string> {
  return {
    name: firstName(leadName),
    business: scores.businessName,
    rank: scores.rank != null ? String(scores.rank) : scores.rankStatus === 'unavailable' ? 'not measured yet' : 'beyond 20',
    // 'n/a' — never a placeholder 0 — when a value wasn't measured.
    profile: scores.profile != null ? String(scores.profile) : 'n/a',
    seo: scores.seo != null ? String(scores.seo) : 'n/a',
    review: scores.review != null ? String(scores.review) : 'n/a',
    competitor: scores.competitor || 'other local businesses',
    keywords: scores.missingKeywords.length
      ? scores.missingKeywords.map((k) => `"${k}"`).join(', ')
      : 'the terms your customers search',
    subscribeUrl: config.subscribeUrl || '',
    shopUrl: config.shopUrl || '',
    rankText: scores.rankText || (scores.rank != null ? `#${scores.rank}` : 'not measured yet'),
    profileText: scores.profileText || (scores.profile != null ? `${scores.profile}%` : 'not measured'),
    seoText: scores.seoText || (scores.seo != null ? `${scores.seo}%` : 'not measured'),
    reviewText: scores.reviewText || 'not measured',
    issuesBlock: scores.verifiedIssues?.length
      ? `What we found:\n${scores.verifiedIssues.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n`
      : '',
  };
}

/** Appended to every sales-AI system prompt in code, so even an older
 *  stored prompt can't produce claims the audit doesn't support. */
const FACT_GUARD = `\n\nFACT RULES (always apply): use only the audit values and verified issues provided. A value "not measured" / "n/a" is unknown — never guess it or call it zero. Never claim what caused a ranking, never predict rankings, never say competitors use GrowwMatics, and never mention a problem that is not in the verified issues.`;

/** Unmodified pre-Sep-2026 defaults are upgraded to the fact-based ones. */
function upgradeLegacy(text: string | undefined, legacy: string, current: string): string | undefined {
  return text?.trim() === legacy.trim() ? current : text;
}

async function aiMessage(systemPrompt: string, context: string): Promise<string | null> {
  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
      ],
      temperature: 0.7,
      // gpt-oss is a reasoning model: hidden reasoning shares this budget,
      // and 600 truncated the first message mid-sentence in a live check.
      max_tokens: 1500,
      reasoning_effort: 'low',
    });
    const text = res.choices?.[0]?.message?.content?.trim();
    return text && text.length > 20 ? text : null;
  } catch (err: any) {
    console.warn('[salesAgent] AI message failed:', err?.message);
    return null;
  }
}

/** Composes the first-touch message (AI or template per config). */
export async function composeFirstMessage(
  config: SalesAgentConfigShape,
  scores: ISalesScores,
  leadName: string
): Promise<string> {
  const vars = buildVars(scores, leadName, config);
  const aiPrompt = upgradeLegacy(config.firstMessage.aiSystemPrompt, LEGACY_FIRST_AI_PROMPT, DEFAULT_FIRST_AI_PROMPT);
  if (config.firstMessage.mode === 'ai' && aiPrompt) {
    const context =
      `Lead first name: ${vars.name}\nBusiness: ${vars.business}\nGoogle Maps rank: ${vars.rankText}\n` +
      `Profile completion: ${vars.profileText}\nProfile SEO score: ${vars.seoText}\nReviews: ${vars.reviewText}\n` +
      `Verified issues: ${scores.verifiedIssues?.length ? scores.verifiedIssues.join('; ') : 'none'}\n` +
      `Business shown above them in searches: ${scores.competitor || 'unknown'}`;
    const ai = await aiMessage(withGuardrail(aiPrompt + FACT_GUARD), context);
    if (ai) return ai;
  }
  return renderTemplate(upgradeLegacy(config.firstMessage.template, LEGACY_FIRST_TEMPLATE, DEFAULT_FIRST_TEMPLATE) || DEFAULT_FIRST_TEMPLATE, vars);
}

/** Composes a follow-up drip message (AI or template per config). */
export async function composeFollowUp(
  followUp: SalesFollowUp,
  config: SalesAgentConfigShape,
  scores: ISalesScores,
  leadName: string
): Promise<string> {
  const vars = buildVars(scores, leadName, config);
  if (followUp.mode === 'ai' && followUp.aiSystemPrompt) {
    const context = `Lead: ${vars.name}, business ${vars.business}, Google Maps rank ${vars.rankText}, profile completion ${vars.profileText}, reviews ${vars.reviewText}. Verified issues: ${scores.verifiedIssues?.join('; ') || 'none'}. Subscribe link: ${vars.subscribeUrl}`;
    const ai = await aiMessage(withGuardrail(followUp.aiSystemPrompt + FACT_GUARD), context);
    if (ai) return ai;
  }
  const legacyIdx = LEGACY_FOLLOWUP_TEMPLATES.findIndex((t) => t.trim() === followUp.template?.trim());
  const template = legacyIdx >= 0 ? DEFAULT_FOLLOWUPS[legacyIdx]?.template ?? followUp.template : followUp.template;
  return renderTemplate(template, vars);
}

/** Composes a live reply to an inbound lead message, using the full history. */
export async function composeAgentReply(
  config: SalesAgentConfigShape,
  convo: Pick<ISalesConversation, 'scores' | 'leadName' | 'messages'>
): Promise<string> {
  const vars = buildVars(convo.scores, convo.leadName, config);

  // Compact, approved business knowledge — grounds the persona so it answers
  // as GrowwMatics-the-business, not with a generic one-liner. Only non-empty
  // configured fields appear; capped so it can't blow the prompt budget.
  // Empty string when nothing is configured — the persona then behaves
  // exactly as before.
  const knowledge = summariseKnowledge(config.knowledge, { maxItems: 6, includeFaqs: true });
  const knowledgeBlock = knowledge
    ? `\nGROWWMATICS BUSINESS KNOWLEDGE (approved — convey these facts; never add a price, ` +
      `feature, integration, guarantee, statistic or customer number that is NOT below):\n${knowledge}\n`
    : '';

  const contextHeader =
    `${currentTimeLine()}\n` +
    knowledgeBlock +
    `\nAUDIT CONTEXT — Business: ${vars.business}, Google rank: ${vars.rank}, profile ${vars.profile}%, ` +
    `SEO ${vars.seo}%, reviews ${vars.review}%, top competitor ${vars.competitor}, missing keywords ${vars.keywords}.\n` +
    `Subscribe link: ${vars.subscribeUrl || '(none)'} · Platform link: ${vars.shopUrl || '(none)'}.\n` +
    `You have no other links, no demo video, and no ability to schedule or confirm a specific meeting time — ` +
    `never invent one. If the lead wants a live demo, call, or walkthrough, tell them you'll get a specific ` +
    `time booked for them and hand them to booking — don't propose times or links yourself.\n\n` +
    `Reply to the lead's latest message. Conversation so far:\n` +
    convo.messages
      .slice(-10)
      .map((m) => `${m.role === 'lead' ? 'Lead' : 'You'}: ${m.text}`)
      .join('\n');

  const ai = await aiMessage(withGuardrail(config.agentSystemPrompt), contextHeader);
  return (
    ai ||
    `Thanks ${vars.name}! I'd love to help you fix your Google visibility and get ahead of ${vars.competitor}. ` +
      (vars.subscribeUrl ? `You can get started here: ${vars.subscribeUrl}` : `Reply here and I'll guide you.`)
  );
}
