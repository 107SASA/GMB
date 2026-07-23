import Groq from 'groq-sdk';
import dbConnect from '@/lib/mongodb';
import SalesAgentConfig from '@/models/SalesAgentConfig';
import type { ISalesConversation, ISalesScores } from '@/models/SalesConversation';
import {
  defaultSalesAgentConfig,
  renderTemplate,
  type SalesAgentConfigShape,
  type SalesFollowUp,
} from '@/lib/salesAgentDefaults';

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
  return {
    businessName: business?.name ?? audit?.businessName ?? 'your business',
    rank: pct(d.googleSearchRank?.rank ?? audit?.rank),
    profile: pct(d.profileScore?.profileCompletionScore ?? d.profileCompletion?.score),
    seo: pct(d.seoScore?.score ?? d.profileScore?.seoScore),
    review: pct(d.profileScore?.reviewScore),
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
    rank: scores.rank != null ? String(scores.rank) : 'beyond 10',
    profile: scores.profile != null ? String(scores.profile) : '0',
    seo: scores.seo != null ? String(scores.seo) : '0',
    review: scores.review != null ? String(scores.review) : '0',
    competitor: scores.competitor || 'other local businesses',
    keywords: scores.missingKeywords.length
      ? scores.missingKeywords.map((k) => `"${k}"`).join(', ')
      : 'the terms your customers search',
    subscribeUrl: config.subscribeUrl || '',
    shopUrl: config.shopUrl || '',
  };
}

async function aiMessage(systemPrompt: string, context: string): Promise<string | null> {
  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
      ],
      temperature: 0.7,
      max_tokens: 600,
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
  if (config.firstMessage.mode === 'ai' && config.firstMessage.aiSystemPrompt) {
    const context =
      `Lead first name: ${vars.name}\nBusiness: ${vars.business}\nGoogle rank: ${vars.rank}\n` +
      `Profile completion: ${vars.profile}%\nSEO score: ${vars.seo}%\nReviews & replies score: ${vars.review}%\n` +
      `Missing keywords: ${vars.keywords}\nTop competitor: ${vars.competitor}`;
    const ai = await aiMessage(config.firstMessage.aiSystemPrompt, context);
    if (ai) return ai;
  }
  return renderTemplate(config.firstMessage.template, vars);
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
    const context = `Lead: ${vars.name}, business ${vars.business}, rank ${vars.rank}, profile ${vars.profile}%, competitor ${vars.competitor}. Subscribe link: ${vars.subscribeUrl}`;
    const ai = await aiMessage(followUp.aiSystemPrompt, context);
    if (ai) return ai;
  }
  return renderTemplate(followUp.template, vars);
}

/** Composes a live reply to an inbound lead message, using the full history. */
export async function composeAgentReply(
  config: SalesAgentConfigShape,
  convo: Pick<ISalesConversation, 'scores' | 'leadName' | 'messages'>
): Promise<string> {
  const vars = buildVars(convo.scores, convo.leadName, config);
  const contextHeader =
    `AUDIT CONTEXT — Business: ${vars.business}, Google rank: ${vars.rank}, profile ${vars.profile}%, ` +
    `SEO ${vars.seo}%, reviews ${vars.review}%, top competitor ${vars.competitor}, missing keywords ${vars.keywords}.\n` +
    `Subscribe link: ${vars.subscribeUrl || '(none)'} · Platform link: ${vars.shopUrl || '(none)'}.\n\n` +
    `Reply to the lead's latest message. Conversation so far:\n` +
    convo.messages
      .slice(-10)
      .map((m) => `${m.role === 'lead' ? 'Lead' : 'You'}: ${m.text}`)
      .join('\n');

  const ai = await aiMessage(config.agentSystemPrompt, contextHeader);
  return (
    ai ||
    `Thanks ${vars.name}! I'd love to help you fix your Google visibility and get ahead of ${vars.competitor}. ` +
      (vars.subscribeUrl ? `You can get started here: ${vars.subscribeUrl}` : `Reply here and I'll guide you.`)
  );
}
