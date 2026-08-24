import Groq from 'groq-sdk';
import dbConnect from '@/lib/mongodb';
import { GROQ_MODEL } from '@/lib/aiModel';
import User from '@/models/User';
import Business from '@/models/Business';
import Audit from '@/models/Audit';
import type { ISupportConversation } from '@/models/SupportConversation';
import { AGENT_SCOPE_GUARDRAIL } from '@/lib/agentGuardrails';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Groq/network failure, or a response the model returned empty — same
// "never leave the customer with silence" reasoning as
// AGENT_DISABLED_FALLBACK_MESSAGE in services/inngest/functions.ts, just
// scoped locally since this agent has no enabled/disabled config toggle.
export const SUPPORT_FALLBACK_MESSAGE =
  "Thanks for reaching out — our team will get back to you shortly.";

function firstName(name?: string): string {
  const n = (name || '').trim().split(/\s+/)[0];
  return n || '';
}

/**
 * Best-effort context for personalizing the acknowledgment — name, active
 * business, latest audit score. Never throws; a lookup failure just means a
 * less-personalized (still correct) reply.
 */
async function buildCustomerContext(userId: string): Promise<string> {
  try {
    await dbConnect();
    const user = await User.findById(userId, 'fullName activeBusinessId').lean() as any;
    if (!user) return '';

    const parts: string[] = [];
    if (user.fullName) parts.push(`Customer name: ${firstName(user.fullName)}`);

    if (user.activeBusinessId) {
      const business = await Business.findById(user.activeBusinessId, 'name').lean() as any;
      if (business?.name) parts.push(`Their business: ${business.name}`);

      const latestAudit = await Audit.findOne(
        { businessId: user.activeBusinessId, status: 'COMPLETED' },
        'overallScore'
      )
        .sort({ createdAt: -1 })
        .lean() as any;
      if (latestAudit?.overallScore != null) {
        parts.push(`Latest audit score: ${latestAudit.overallScore}/100`);
      }
    }

    return parts.join('\n');
  } catch (err: any) {
    console.warn('[supportAgent] context lookup failed:', err?.message);
    return '';
  }
}

/**
 * One-shot acknowledgment reply for an inbound support message — not a
 * multi-turn conversation (unlike composeAgentReply in salesAgent.ts /
 * bookingAgent.ts, which extract structured JSON across many turns). Plain
 * text completion; falls back to a static message on any failure so the
 * customer is never left without a reply.
 */
export async function composeSupportReply(
  convo: Pick<ISupportConversation, 'messages' | 'leadName' | 'userId'>
): Promise<string> {
  const lastMessage = convo.messages[convo.messages.length - 1]?.text || '';
  const context = convo.userId ? await buildCustomerContext(convo.userId.toString()) : '';

  const systemPrompt =
    `${AGENT_SCOPE_GUARDRAIL}\n\n` +
    `You are GrowwMatics AI's support acknowledgment assistant, replying over WhatsApp to a customer who just ` +
    `asked for help. Your ONLY job is a brief, warm, human-sounding acknowledgment — you are NOT answering their ` +
    `question yourself and must not invent troubleshooting steps, feature explanations, or account details you ` +
    `don't have.\n\n` +
    `Rules:\n` +
    `- 2-3 short sentences max.\n` +
    `- If given context below, use it naturally (e.g. their first name, their business name) — never fabricate ` +
    `anything not given to you.\n` +
    `- Always make clear a real team member will follow up soon.\n` +
    // Was "Never mention that you are an AI... just reply naturally" — read as
    // an instruction to deny it if asked, which the shared guardrail above
    // explicitly forbids. This just keeps the "don't lead with it" stylistic
    // goal without the denial framing.
    `- Don't lead with "I'm an AI" or open by announcing you're a bot — reply naturally. If directly asked, answer honestly (see the rules above).\n\n` +
    (context ? `Known context:\n${context}` : 'No account context available — keep it generic and friendly.');

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Customer's message: "${lastMessage}"\n\nWrite the acknowledgment reply.` },
      ],
      temperature: 0.6,
      max_tokens: 150,
    });
    const reply = res.choices?.[0]?.message?.content?.trim();
    return reply || SUPPORT_FALLBACK_MESSAGE;
  } catch (err: any) {
    console.warn('[supportAgent] AI reply failed:', err?.message);
    return SUPPORT_FALLBACK_MESSAGE;
  }
}
