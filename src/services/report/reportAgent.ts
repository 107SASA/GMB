import Groq from 'groq-sdk';
import dbConnect from '@/lib/mongodb';
import { GROQ_MODEL } from '@/lib/aiModel';
import ReportAgentConfig from '@/models/ReportAgentConfig';
import type { IReportConversation } from '@/models/ReportConversation';
import {
  defaultReportAgentConfig,
  renderTemplate,
  type ReportAgentConfigShape,
} from '@/lib/reportAgentDefaults';
import { AGENT_SCOPE_GUARDRAIL } from '@/lib/agentGuardrails';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export function firstName(name?: string): string {
  const n = (name || '').trim().split(/\s+/)[0];
  return n || 'there';
}

/** Loads the singleton report-agent config, creating defaults once. */
export async function getReportAgentConfig(): Promise<ReportAgentConfigShape> {
  await dbConnect();
  const existing = (await ReportAgentConfig.findOne({ key: 'default' }).lean()) as any;
  if (existing) {
    return { ...defaultReportAgentConfig(), ...existing };
  }
  const created = defaultReportAgentConfig();
  await ReportAgentConfig.create({ key: 'default', ...created });
  return created;
}

/** Deterministic first message — no LLM needed, just hands over the connect link. */
export function composeIntroMessage(config: ReportAgentConfigShape, connectLink: string): string {
  return renderTemplate(config.reportIntroTemplate, { link: connectLink });
}

/**
 * Pre-connection chat replies (questions/objections before the visitor taps
 * the link). Free-text via Groq, mirrors src/services/sales/salesAgent.ts's
 * composeAgentReply — no JSON contract needed since there's nothing
 * structured to extract, unlike the booking agent.
 */
export async function composeAgentReply(
  config: ReportAgentConfigShape,
  convo: Pick<IReportConversation, 'messages' | 'leadName'>,
  connectLink: string
): Promise<string> {
  const context =
    `The visitor's connect link (repeat it if they ask or seem stuck): ${connectLink}\n\n` +
    `Conversation so far:\n` +
    (convo.messages || [])
      .slice(-10)
      .map((m) => `${m.role === 'lead' ? 'Prospect' : 'You'}: ${m.text}`)
      .join('\n');

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: `${AGENT_SCOPE_GUARDRAIL}\n\n${config.agentSystemPrompt}` },
        { role: 'user', content: context },
      ],
      temperature: 0.7,
      max_tokens: 400,
    });
    const text = res.choices?.[0]?.message?.content?.trim();
    if (text) return text;
  } catch (err: any) {
    console.warn('[reportAgent] AI reply failed:', err?.message);
  }

  return `No worries — here's your link again: ${connectLink}\n\nTakes under a minute, and your free report will be ready right after. 🙂`;
}

export interface ReportScores {
  businessName: string;
  rank: string;
  profile: string;
  seo: string;
  review: string;
}

function pct(n: unknown, fallback = '0'): string {
  const v = Number(n);
  return Number.isFinite(v) ? String(Math.round(v)) : fallback;
}

/**
 * Pulls the numbers the report card / summary message reference out of a
 * completed audit. Same field paths as extractScores in
 * src/services/sales/salesAgent.ts (already proven against real audit data).
 */
export function extractReportScores(audit: any, business: any): ReportScores {
  const d = audit?.auditData ?? {};
  const rankValue = d.googleSearchRank?.rank ?? audit?.rank;
  return {
    businessName: business?.name ?? audit?.businessName ?? 'your business',
    rank: Number.isFinite(Number(rankValue)) ? String(Math.round(Number(rankValue))) : 'beyond 20',
    profile: pct(d.profileScore?.profileCompletionScore ?? d.profileCompletion?.score),
    seo: pct(d.seoScore?.score ?? d.profileScore?.seoScore),
    review: pct(d.profileScore?.reviewScore),
  };
}

/** Deterministic — template-rendered from the completed audit's real numbers, not model-generated. */
export function composeSummaryMessage(
  config: ReportAgentConfigShape,
  scores: ReportScores,
  leadName: string,
  dashboardLink: string
): string {
  return renderTemplate(config.reportSummaryTemplate, {
    name: firstName(leadName),
    business: scores.businessName,
    rank: scores.rank,
    profile: scores.profile,
    seo: scores.seo,
    review: scores.review,
    dashboardLink,
  });
}
