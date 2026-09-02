/**
 * NBA EXECUTOR — turns a decided nextBestAction into a concrete, safe,
 * idempotent effect.
 *
 * The missing "ACT" step in the loop:
 *
 *   Lead intelligence  ->  decideNextAction (NBA_SELECTED)  ->  THIS FILE
 *        ->  Outbound Orchestrator / Scheduler  ->  WhatsApp  ->  NBA_EXECUTED
 *
 * Design constraints (from the build brief):
 *  - The LLM NEVER sends a message directly. It only composes text; every
 *    send goes through requestOutboundMessage (the safety gate) with a
 *    sendOutboundMessage fallback for leads outside the V2 cohort.
 *  - Explicit typed actions, one small handler each — not one giant file of
 *    autonomous logic.
 *  - Only actions the current infrastructure can safely perform actually
 *    execute. Anything else is a logged no-op (NBA_EXECUTED outcome:
 *    'deferred') — never a fake "done".
 *  - Every handler re-checks HUMAN ownership / opt-out / customer status
 *    against the CURRENT lead doc before doing anything (defence in depth on
 *    top of the orchestrator's own checks).
 *  - Idempotent: an idempotencyKey derived from leadId + action + a coarse
 *    time bucket guards against double execution on retries.
 *
 * Called from:
 *  - salesAgentReply (after the live reply is sent): react to what the lead
 *    just said — pricing question, objection, demo ask, etc.
 *  - nurtureSchedulerTick (a due EXECUTE_NBA ScheduledAction): proactive
 *    nurture step.
 */
import mongoose from 'mongoose';
import Groq from 'groq-sdk';
import dbConnect from '@/lib/mongodb';
import Lead, { type ILead } from '@/models/Lead';
import { GROQ_MODEL } from '@/lib/aiModel';
import { logLeadEvent } from '@/services/leadEvents';
import { isHumanOwned, isOptedOutOrDoNotContact } from '@/services/agentHandoff/isHumanOwned';
import { requestOutboundMessage } from '@/services/orchestration/outboundOrchestrator';
import { sendOutboundMessage } from '@/services/whatsapp/send';
import { getSalesAgentConfig } from '@/services/sales/salesAgent';
import { AGENT_SCOPE_GUARDRAIL } from '@/lib/agentGuardrails';
import type { NBAAction } from './rules';
import type { SalesAgentConfigShape } from '@/lib/salesAgentDefaults';

export { EXECUTABLE_NBA_ACTIONS, isExecutableNbaAction } from './executableActions';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface ExecuteContext {
  /** Recent conversation, oldest first — for grounding the composed reply. */
  history?: { role: 'lead' | 'agent'; text: string }[];
  /** The lead's latest inbound message, when this run reacts to one. */
  lastInboundText?: string;
  /** 'reply' = triggered by an inbound message; 'proactive' = scheduled nurture. */
  trigger: 'reply' | 'proactive';
  /** businessId for send.ts routing, when known (platform leads: undefined). */
  businessId?: string;
}

export type ExecuteOutcome =
  | { outcome: 'sent'; action: NBAAction; sid?: string; text?: string }
  | { outcome: 'handoff'; action: NBAAction; to: string }
  | { outcome: 'scheduled'; action: NBAAction }
  | { outcome: 'noop'; action: NBAAction; reason: string }
  | { outcome: 'deferred'; action: NBAAction; reason: string }
  | { outcome: 'skipped'; action: NBAAction; reason: string };

// The executable-action set + isExecutableNbaAction live in
// ./executableActions (dependency-free, re-exported above) so they can be
// unit-tested without loading this whole module.

// SCHEDULE_DEMO is deliberately NOT booked here — the deterministic
// booking flow (BookingConversation + real Google Calendar slots) owns that,
// reached via the booking-keyword handoff in the webhook or an OFFER_DEMO
// reply that gets the lead to ask. The executor treats a bare SCHEDULE_DEMO
// as OFFER_DEMO (nudge them to confirm they want it) rather than trying to
// book unilaterally.

export async function executeNextAction(
  leadId: string | mongoose.Types.ObjectId,
  action: NBAAction,
  ctx: ExecuteContext
): Promise<ExecuteOutcome> {
  try {
    await dbConnect();
    const lead = await Lead.findById(leadId);
    if (!lead) return { outcome: 'skipped', action, reason: 'lead-not-found' };

    // --- Fresh safety re-check (defence in depth) --------------------------
    if (isHumanOwned(lead)) return skip(lead, action, 'human-owned');
    if (isOptedOutOrDoNotContact(lead)) return skip(lead, action, 'opted-out-or-do-not-contact');
    if (lead.currentStage === 'CUSTOMER' || lead.currentAgent === 'IN_HOUSE') {
      return skip(lead, action, 'already-customer');
    }

    logLeadEvent('NBA_SELECTED', { action, trigger: ctx.trigger }, 'nba-executor', {
      leadId: lead._id, phone: lead.phone,
    });

    // --- Non-message actions --------------------------------------------------
    if (action === 'WAIT') {
      return done(lead, action, { outcome: 'noop', action, reason: 'wait' });
    }
    if (action === 'STOP') {
      // decideNextAction only picks STOP for opted-out / do-not-contact leads,
      // both already caught above — reaching here means state changed under
      // us. Treat as a no-op, never a send.
      return done(lead, action, { outcome: 'noop', action, reason: 'stop' });
    }
    if (action === 'HUMAN_HANDOFF') {
      const { setLeadOwnership } = await import('@/services/leadOwnership/setLeadOwnership');
      lead.humanHandoff = { ...(lead.humanHandoff || { active: false }), active: true, reason: 'nba-human-handoff', since: new Date() };
      await lead.save();
      await setLeadOwnership(lead._id, 'HUMAN', 'nba-human-handoff', 'nba-executor', 'HUMAN_HANDOFF');
      try {
        const { sendPushToSuperAdmins } = await import('@/services/push');
        await sendPushToSuperAdmins({
          title: 'Lead needs a human',
          body: `${lead.name || lead.phone} — the AI decided this lead should be handled by a person.`,
          data: { leadId: String(lead._id) },
        });
      } catch { /* push is best-effort */ }
      return done(lead, action, { outcome: 'handoff', action, to: 'HUMAN' });
    }
    if (action === 'SCHEDULE_DEMO' || action === 'OFFER_DEMO') {
      // Both resolve to "nudge the lead to confirm they want a demo" — the
      // real booking happens in the deterministic BookingConversation flow
      // once they say yes (webhook booking-keyword handoff). We do NOT create
      // a BookingConversation unilaterally from a decision.
      return sendComposed(lead, action, ctx, demoNudgeBrief);
    }

    // --- Message actions (LLM composes, orchestrator sends) -----------------
    const config = await getSalesAgentConfig();

    switch (action) {
      case 'SEND_PRICING': {
        if (config.knowledge.pricingResponse && config.knowledge.pricingResponse.trim()) {
          // Approved pricing text exists — send it (rendered), do NOT let the
          // LLM paraphrase a number.
          return sendFixed(lead, action, ctx, renderKnowledge(config.knowledge.pricingResponse, lead, config));
        }
        // No approved pricing — never invent one. Ask a qualification
        // question that moves the conversation forward instead.
        logLeadEvent('NBA_OVERRIDDEN', {
          suggested: 'SEND_PRICING', used: 'ASK_QUALIFICATION', reason: 'no_approved_pricing_content',
        }, 'nba-executor', { leadId: lead._id, phone: lead.phone });
        return sendComposed(lead, 'ASK_QUALIFICATION', ctx, qualificationBrief);
      }

      case 'HANDLE_OBJECTION': {
        const open = (lead.objections || []).find((o: { resolved: boolean }) => !o.resolved) as
          | { type: 'PRICE' | 'DECISION_MAKER' | 'TIMING' | 'TRUST' | 'FEATURE_GAP' | 'OTHER'; note?: string; resolved: boolean }
          | undefined;
        const approved = open?.type ? config.knowledge.objectionResponses?.[open.type] : undefined;
        if (approved && approved.trim()) {
          return sendFixed(lead, action, ctx, renderKnowledge(approved, lead, config));
        }
        // No approved objection response — compose a grounded reply from the
        // persona + audit context only (the persona prompt already forbids
        // fabricating prices/features), acknowledging the concern honestly.
        return sendComposed(lead, action, ctx, (l, c) => objectionBrief(l, c, open?.type, open?.note));
      }

      case 'ANSWER_QUESTION':
        return sendComposed(lead, action, ctx, (l, c) => answerBrief(l, c, config, ctx.lastInboundText));

      case 'ASK_QUALIFICATION':
        return sendComposed(lead, action, ctx, qualificationBrief);

      case 'EDUCATE':
        return sendComposed(lead, action, ctx, (l, c) => educateBrief(l, c, config));

      case 'SHARE_USE_CASE':
        return sendComposed(lead, action, ctx, (l, c) => useCaseBrief(l, c, config));

      case 'SHOW_VALUE':
        return sendComposed(lead, action, ctx, showValueBrief);

      case 'OFFER_SUBSCRIPTION':
        return sendComposed(lead, action, ctx, (l, c) => offerSubscriptionBrief(l, c, config));

      case 'FOLLOW_UP_AFTER_DEMO':
        return sendComposed(lead, action, ctx, postDemoBrief);

      case 'REENGAGE':
        return sendComposed(lead, action, ctx, reengageBrief);

      default:
        return done(lead, action, { outcome: 'deferred', action, reason: 'not-executable-yet' });
    }
  } catch (err: any) {
    console.warn('[nba-executor] executeNextAction failed:', err?.message);
    return { outcome: 'skipped', action, reason: `threw: ${err?.message || 'unknown'}` };
  }
}

// ---------------------------------------------------------------------------
// Send helpers
// ---------------------------------------------------------------------------

/**
 * Route a proactive send through the orchestrator; if the lead is outside the
 * V2 cohort (FALL_BACK_TO_LEGACY) fall back to sendOutboundMessage directly,
 * exactly as runSalesFollowUpDrip's contract expects. A reply-trigger send is
 * treated as isReply:true (no cooldown).
 */
async function routeSend(
  lead: ILead,
  action: NBAAction,
  ctx: ExecuteContext,
  buildText: () => Promise<string>
): Promise<ExecuteOutcome> {
  const isReply = ctx.trigger === 'reply';
  const dayBucket = new Date().toISOString().slice(0, 13); // hour bucket
  const idempotencyKey = `${lead._id}-NBA-${action}-${ctx.trigger}-${dayBucket}`;

  // Compose once, reuse for both the orchestrator path and the fallback path,
  // so the returned `text` always matches what actually went out.
  let composed: string | undefined;
  const buildOnce = async () => {
    if (composed === undefined) composed = await buildText();
    return composed;
  };

  const orchestrated = await requestOutboundMessage({
    leadId: String(lead._id),
    agent: (lead.currentAgent as 'SALES' | 'DEMO' | 'IN_HOUSE') || 'SALES',
    messageBuilder: buildOnce,
    isReply,
    idempotencyKey,
  });

  if (orchestrated.decision === 'SENT') {
    return done(lead, action, { outcome: 'sent', action, sid: orchestrated.sid, text: composed });
  }
  if (orchestrated.decision === 'REJECTED') {
    return skip(lead, action, `orchestrator-rejected:${orchestrated.reason}`);
  }

  // FALL_BACK_TO_LEGACY — lead not in the V2 cohort. Send directly, same as
  // every legacy path does today. Still safe: the HUMAN/opt-out/customer
  // re-checks at the top of executeNextAction already ran against fresh state.
  const text = await buildOnce();
  const res = await sendOutboundMessage(lead.phone || '', text, String(lead._id), ctx.businessId);
  if (res.success) {
    if (ctx.trigger === 'proactive') {
      lead.lastProactiveMessageAt = new Date();
      await lead.save();
    }
    logLeadEvent('MESSAGE_SENT', {
      channel: 'whatsapp', agent: lead.currentAgent || 'SALES', isReply, sid: res.sid,
      source: ctx.trigger === 'reply' ? 'AGENT_REPLY' : 'V2_NURTURE', nbaAction: action,
    }, 'nba-executor', { leadId: lead._id, phone: lead.phone });
    return done(lead, action, { outcome: 'sent', action, sid: res.sid, text });
  }
  return skip(lead, action, `send-failed:${res.error || 'unknown'}`);
}

/** Compose with the LLM (grounded brief) then route. */
function sendComposed(
  lead: ILead,
  action: NBAAction,
  ctx: ExecuteContext,
  brief: (lead: ILead, ctx: ExecuteContext) => string
): Promise<ExecuteOutcome> {
  return routeSend(lead, action, ctx, () => composeGrounded(brief(lead, ctx), ctx));
}

/** Send an exact approved string (still rendered for {{vars}}), no LLM. */
function sendFixed(lead: ILead, action: NBAAction, ctx: ExecuteContext, text: string): Promise<ExecuteOutcome> {
  return routeSend(lead, action, ctx, async () => text);
}

async function composeGrounded(brief: string, ctx: ExecuteContext): Promise<string> {
  const history = (ctx.history || [])
    .slice(-10)
    .map((m) => `${m.role === 'lead' ? 'Lead' : 'You'}: ${m.text}`)
    .join('\n');
  const system = `${AGENT_SCOPE_GUARDRAIL}

You are the GrowwMatics WhatsApp sales assistant. GrowwMatics helps local businesses improve their Google Business Profile visibility (profile completeness, local SEO, reviews, ranking).

Write ONE short WhatsApp message (2-5 sentences, *bold* with single asterisks, at most one emoji, no links unless one is given to you below, no markdown headers). One question at most.

CRITICAL: Never state a specific price, discount, plan name, feature, statistic, or guarantee that is not explicitly given to you in the task below. If you don't have a number or fact you'd need, say you'll confirm it / ask a clarifying question instead — never guess.

TASK: ${brief}`;
  const user = history ? `Conversation so far:\n${history}` : '(no prior conversation)';

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.6,
      max_tokens: 500,
    });
    const text = res.choices?.[0]?.message?.content?.trim();
    if (text && text.length > 15) return text;
  } catch (err: any) {
    console.warn('[nba-executor] compose failed:', err?.message);
  }
  // Deterministic fallback if the LLM is unavailable — safe, generic, no facts.
  return "Thanks for your message! I'd love to help you get more customers from Google. Could you tell me a bit about your business so I can point you in the right direction?";
}

// ---------------------------------------------------------------------------
// Briefs — WHAT to say for each action. Grounded in what we actually know.
// ---------------------------------------------------------------------------

function leadFacts(lead: ILead): string {
  const bits: string[] = [];
  if (lead.name) bits.push(`Lead first name: ${lead.name.split(/\s+/)[0]}`);
  if (lead.businessProfile?.industry) bits.push(`Industry: ${lead.businessProfile.industry}`);
  if (lead.painPoints?.length) bits.push(`Known pain points: ${lead.painPoints.slice(0, 3).join('; ')}`);
  if (lead.intent) bits.push(`Current intent: ${lead.intent}`);
  return bits.join('\n');
}

function qualificationBrief(lead: ILead): string {
  return `Ask ONE friendly qualification question to understand their business and what they want from Google (e.g. type of business, whether they get enough calls/customers from Google today, what they've tried). ${leadFacts(lead)}`;
}

function demoNudgeBrief(lead: ILead): string {
  return `The lead may want a live demo/walkthrough. Warmly offer to set one up and ask them to reply "yes" (or "book a demo") to confirm — a real person will then find a time. Do NOT propose a specific time or send a link. ${leadFacts(lead)}`;
}

function showValueBrief(lead: ILead): string {
  return `Reinforce the value of fixing their Google presence in concrete outcome terms (more calls, more walk-ins, showing up when nearby customers search) WITHOUT inventing statistics. Invite a question. ${leadFacts(lead)}`;
}

function reengageBrief(lead: ILead): string {
  return `This lead went quiet. Send a light, no-pressure re-engagement — acknowledge it's been a while, restate you can help with their Google visibility, ask if they'd like to pick it back up. ${leadFacts(lead)}`;
}

function postDemoBrief(lead: ILead): string {
  return `The lead recently completed a demo. Follow up warmly: ask what they thought, whether they have questions, and whether they're ready to move forward. Do NOT quote a price unless one is given. ${leadFacts(lead)}`;
}

function objectionBrief(lead: ILead, _ctx: ExecuteContext, type?: string, note?: string): string {
  return `The lead raised an objection (type: ${type || 'unknown'}${note ? `, note: "${note}"` : ''}). Acknowledge it honestly and empathetically, focus on outcomes, and ask a question to keep the conversation going. Do NOT invent a price, discount, feature, or guarantee to overcome it — if a concrete fact is needed you don't have, say you'll get it confirmed. ${leadFacts(lead)}`;
}

function answerBrief(lead: ILead, _ctx: ExecuteContext, config: SalesAgentConfigShape, question?: string): string {
  const faqs = (config.knowledge.faqs || []).slice(0, 8)
    .map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');
  const grounding = faqs
    ? `Answer using ONLY these approved Q&A pairs where relevant:\n${faqs}\n\nIf the question isn't covered, say you'll check and get back to them, or ask a clarifying question.`
    : `There is no approved answer library configured. Answer only in general terms about helping their Google visibility, and if they need a specific fact (price, exact feature, timeline) tell them you'll confirm it — do not guess.`;
  return `The lead asked: "${question || '(see conversation)'}". ${grounding} ${leadFacts(lead)}`;
}

function educateBrief(lead: ILead, _ctx: ExecuteContext, config: SalesAgentConfigShape): string {
  const points = (config.knowledge.educationPoints || []).slice(0, 5).join(' | ');
  return points
    ? `Educate the lead using one of these approved points, in your own words: ${points}. ${leadFacts(lead)}`
    : `Briefly explain, in general terms, how a complete Google Business Profile + reviews + local SEO helps a local business get found — no specific statistics or claims. ${leadFacts(lead)}`;
}

function useCaseBrief(lead: ILead, _ctx: ExecuteContext, config: SalesAgentConfigShape): string {
  const cases = (config.knowledge.useCases || []).slice(0, 5).join(' | ');
  return cases
    ? `Share one relevant approved use-case/example in your own words: ${cases}. ${leadFacts(lead)}`
    : `Describe in general terms how a business like theirs benefits from better Google visibility — do NOT invent a specific customer name, number, or result. ${leadFacts(lead)}`;
}

function offerSubscriptionBrief(lead: ILead, _ctx: ExecuteContext, config: SalesAgentConfigShape): string {
  const link = config.subscribeUrl ? `Include this exact signup link once: ${config.subscribeUrl}` : `Do NOT invent a link — tell them you'll send the signup details.`;
  return `The lead is showing purchase interest. Warmly invite them to get started. ${link}. If they have a pricing question and no price is given to you, say you'll confirm the exact plan pricing rather than guessing. ${leadFacts(lead)}`;
}

function renderKnowledge(text: string, lead: ILead, config: SalesAgentConfigShape): string {
  const first = (lead.name || '').trim().split(/\s+/)[0] || 'there';
  return text
    .replace(/\{\{\s*name\s*\}\}/g, first)
    .replace(/\{\{\s*subscribeUrl\s*\}\}/g, config.subscribeUrl || '')
    .replace(/\{\{\s*shopUrl\s*\}\}/g, config.shopUrl || '')
    .replace(/\{\{\s*\w+\s*\}\}/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Outcome logging helpers
// ---------------------------------------------------------------------------

function done(lead: ILead, action: NBAAction, result: ExecuteOutcome): ExecuteOutcome {
  logLeadEvent('NBA_EXECUTED', { action, ...outcomePayload(result) }, 'nba-executor', {
    leadId: lead._id, phone: lead.phone,
  });
  return result;
}

function skip(lead: ILead, action: NBAAction, reason: string): ExecuteOutcome {
  const result: ExecuteOutcome = { outcome: 'skipped', action, reason };
  logLeadEvent('NBA_EXECUTED', { action, outcome: 'skipped', reason }, 'nba-executor', {
    leadId: lead._id, phone: lead.phone,
  });
  return result;
}

function outcomePayload(r: ExecuteOutcome): Record<string, unknown> {
  switch (r.outcome) {
    case 'sent': return { outcome: 'sent', sid: r.sid };
    case 'handoff': return { outcome: 'handoff', to: r.to };
    case 'scheduled': return { outcome: 'scheduled' };
    case 'noop': return { outcome: 'noop', reason: r.reason };
    case 'deferred': return { outcome: 'deferred', reason: r.reason };
    case 'skipped': return { outcome: 'skipped', reason: r.reason };
  }
}
