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
 * Best-effort context for personalizing a reply — name, active business,
 * latest audit score. Never throws; a lookup failure just means a
 * less-personalized (still correct) reply. Shared by both the pre-sale
 * one-shot path and the IN_HOUSE multi-turn path.
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
 * One-shot acknowledgment reply for a PRE-SALE support inquiry (Lead.
 * currentAgent !== 'IN_HOUSE') — not a multi-turn conversation (unlike
 * composeAgentReply in salesAgent.ts/bookingAgent.ts, or
 * composeInHouseAgentReply below). Plain text completion; falls back to a
 * static message on any failure so the customer is never left without a
 * reply.
 *
 * UNCHANGED from before Phase 8 — this is the exact pre-existing behavior
 * for anyone who isn't yet a paying customer (currentAgent !== 'IN_HOUSE'),
 * per the task's explicit "preserve the existing... behavior exactly"
 * requirement. See composeInHouseAgentReply for the new multi-turn path.
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

// ---------------------------------------------------------------------------
// Phase 8 — In-House Agent: real multi-turn support for paying customers
// (Lead.currentAgent === 'IN_HOUSE'). Seeded from EXISTING product content
// already live/maintained elsewhere in this codebase (found via an explicit
// content-search before writing this — no copy invented from scratch):
//   - src/lib/faqData.ts — the real public /faq page + homepage FAQ dataset
//   - src/lib/servicesData.ts — service descriptions + 15 more FAQs
//   - documentation/client-docs/feature-walkthrough.md — the 9 product
//     modules, beginner-friendly "what it is / how it works" per module
//   - documentation/client-docs/admin-guide.md — dashboard paths and
//     concrete setup/how-to steps (e.g. /dashboard/crm, /dashboard/upload)
// FLAG for a content owner: pricing details are intentionally NOT baked in
// here (they're dynamic — fetched from /api/billing/plans — and the single-
// plan billing model can change without a code deploy); the prompt tells
// the model to point pricing questions at the in-app Billing page rather
// than state a number that could go stale. If deeper troubleshooting
// content (beyond documentation/troubleshooting/troubleshooting-guide.md,
// which is currently written for developers, not end users) gets written
// for customers, fold it in here too.
// ---------------------------------------------------------------------------

const PRODUCT_KNOWLEDGE = `GrowwMatics AI — product knowledge for support conversations:

WHAT IT IS: An AI-powered platform that manages a local business's Google Business Profile (GBP), automates review management, generates content, and runs WhatsApp-based lead capture — all from one dashboard.

THE 9 MODULES (what to explain when a customer asks "what does X do" or "how do I use X"):
1. GMB Audit Engine ("SEO X-Ray") — analyzes a business's live Google Maps listing (photos, reviews, profile completeness) and scores it (SEO, engagement, etc), showing exactly what to fix to rank higher.
2. AI Content Generator — drafts Google Business posts (choose a tone like Professional/Friendly, and a type like Promotional/Educational/FAQ) with local SEO keywords and a call-to-action.
3. Scheduler & Auto-Posting — maintains a rolling 7-day buffer of scheduled posts; if it drops below 7 days the AI auto-fills it. Dashboard path: /dashboard/posts. Manual post generation: /dashboard/content.
4. Review Management Agent — pulls in Google reviews, tags sentiment (Positive/Neutral/Negative/Critical), and drafts a reply to each. Critical 1-star reviews trigger an instant alert to the business owner. Dashboard path: /dashboard/reviews — click a draft to edit it, then Approve.
5. CRM System — a drag-and-drop Kanban board of leads (New → Contacted → Qualified → Interested → Booking Pending → Converted). Dashboard path: /dashboard/crm.
6. WhatsApp AI Agent — replies instantly to customers texting the business's WhatsApp number, gathers their requirements/budget, and saves it to the CRM with an intent score.
7. Automation Engine — the background system (built on Inngest) that runs crons, retries failed sends, and handles timed follow-ups. Mostly invisible to the customer; mention only if they ask why something happens "automatically" or with a delay.
8. Admin Dashboard — the main control panel at /dashboard, dark-mode UI, unifies every module.
9. Review Generation System — upload a CSV of past customers (headers: name, phone, email, lastVisit, totalSpent) at /dashboard/upload; the platform SMS-texts them a review request, with a reminder after 2 days if they haven't clicked.

MULTI-BUSINESS: one account can hold multiple business workspaces, switchable from the dashboard; each workspace has its own subscription.

DRAFT vs AUTO-PILOT: content/replies can be set to "Draft Mode" (AI prepares, human approves) or "Auto-Pilot" (AI posts/replies automatically once it has learned the brand voice) — the customer controls which.

FREE REPORT: every new business gets one free GBP audit/report before subscribing — no card required. It includes a profile completeness score, review summary, business category, and a competitor comparison.

WHATSAPP CONNECTION: review campaigns, review reminders, and the WhatsApp sales/booking/CRM agents require a connected WhatsApp Business number; the audit/content-generation modules work without it.

PRICING/BILLING: never state a specific price — plans and pricing are managed dynamically and can change. Point the customer to their in-app Billing page (mention it's under their dashboard) or offer to have a team member follow up on billing specifics.`;

/**
 * Multi-turn support reply for a PAYING CUSTOMER (Lead.currentAgent ===
 * 'IN_HOUSE') — welcome/onboarding guidance, setup assistance, and product
 * Q&A grounded in PRODUCT_KNOWLEDGE above, using the last several turns of
 * conversation for context (same shape as salesAgent.ts's composeAgentReply
 * — full history slice, single Groq call, graceful text fallback). Falls
 * back to SUPPORT_FALLBACK_MESSAGE on any failure so the customer is never
 * left without a reply.
 */
export async function composeInHouseAgentReply(
  convo: Pick<ISupportConversation, 'messages' | 'leadName' | 'userId'>
): Promise<string> {
  const context = convo.userId ? await buildCustomerContext(convo.userId.toString()) : '';

  const systemPrompt =
    `${AGENT_SCOPE_GUARDRAIL}\n\n` +
    `You are GrowwMatics AI's In-House support agent, replying over WhatsApp to an EXISTING, PAYING customer. ` +
    `Unlike a pre-sale inquiry, you can and should actually help: answer product questions, walk them through ` +
    `setup/onboarding, and troubleshoot using ONLY the product knowledge below — never invent a feature, dashboard ` +
    `path, or behavior that isn't described there.\n\n` +
    `Rules:\n` +
    `- Be genuinely helpful and specific — give real steps/paths when the knowledge below has them, not vague reassurance.\n` +
    `- If the question is outside what's covered below (a bug report, an account-specific issue, billing dispute, ` +
    `or anything you're not confident about), say so honestly and offer to have a team member follow up — don't guess.\n` +
    `- Keep replies conversational WhatsApp length — a few sentences, not a wall of text. Break multi-step ` +
    `instructions into a short numbered list if needed.\n` +
    `- If given context below (their name/business), use it naturally.\n\n` +
    `${PRODUCT_KNOWLEDGE}\n\n` +
    (context ? `Known context about this customer:\n${context}` : 'No extra account context available.');

  const history = (convo.messages || [])
    .slice(-12)
    .map((m) => `${m.role === 'lead' ? 'Customer' : 'You'}: ${m.text}`)
    .join('\n');

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Conversation so far:\n${history}\n\nWrite your next reply.` },
      ],
      temperature: 0.5,
      max_tokens: 500,
    });
    const reply = res.choices?.[0]?.message?.content?.trim();
    return reply || SUPPORT_FALLBACK_MESSAGE;
  } catch (err: any) {
    console.warn('[supportAgent] In-House AI reply failed:', err?.message);
    return SUPPORT_FALLBACK_MESSAGE;
  }
}
