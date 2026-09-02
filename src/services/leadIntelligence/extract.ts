import Groq from 'groq-sdk';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { GROQ_MODEL } from '@/lib/aiModel';
import Lead from '@/models/Lead';
import ScoringRuleConfig, { DEFAULT_SCORING_RULES } from '@/models/ScoringRuleConfig';
import { logLeadEvent } from '@/services/leadEvents';
import { decideNextAction } from '@/services/nba/decideNextAction';
import { NBA_ACTIONS } from '@/services/nba/rules';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const VALID_INTENTS = [
  'EXPLORING', 'LEARNING', 'PROBLEM_AWARE', 'SOLUTION_AWARE',
  'DEMO_INTEREST', 'PURCHASE_INTEREST', 'READY_TO_BUY', 'NOT_INTERESTED',
] as const;
type Intent = (typeof VALID_INTENTS)[number];

const VALID_OBJECTION_TYPES = ['PRICE', 'DECISION_MAKER', 'TIMING', 'TRUST', 'FEATURE_GAP', 'OTHER'] as const;
type ObjectionType = (typeof VALID_OBJECTION_TYPES)[number];

const VALID_SIGNALS = DEFAULT_SCORING_RULES.map((r) => r.signal);

interface ExtractionResult {
  intent?: string;
  pain_points?: string[];
  objections?: { type?: string; note?: string }[];
  buying_signals?: string[];
  score_signal?: string;
  confidence?: number;
  // Phase 4 addition — the LLM's own guess at what should happen next.
  // decideNextAction() treats this as advisory only: it's used verbatim
  // ONLY if it's a member of the rule engine's legal-action set for this
  // lead's current state AND confidence >= 0.5; otherwise the rule
  // engine's own defaultAction wins and an NBA_OVERRIDDEN event is logged.
  // See services/nba/decideNextAction.ts.
  suggested_action?: string;
}

export interface ConversationTurn {
  role: 'lead' | 'agent';
  text: string;
}

/**
 * A message is "substantive" enough to move lastMeaningfulInteractionAt if
 * it's more than a single bare word/emoji/ack ("ok", "yes", "👍", "hi") —
 * those carry no real signal about the lead's intent or situation.
 */
function isSubstantiveMessage(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length > 1 && trimmed.length > 3;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// NOTE: the JSON example below deliberately contains only valid, concrete
// JSON (real string literals, not "A" | "B" pipe-union pseudo-types) — an
// earlier version embedded TypeScript-union syntax directly inside the JSON
// shape, which is invalid JSON and made Groq's strict json_object validator
// reject the completion outright (400 json_validate_failed) on some inputs.
// The allowed enum values are listed in plain English instead.
const EXTRACTION_SYSTEM_PROMPT = `You analyze a single inbound WhatsApp message from a sales/demo prospect and extract structured signals about them. You are NOT writing a reply — only classifying.

Respond with a SINGLE JSON object and NOTHING else, matching this example shape exactly (keys and types, not these literal values):
{
  "intent": "EXPLORING",
  "pain_points": ["short phrase describing a problem they mentioned"],
  "objections": [{"type": "PRICE", "note": "short note on what they said"}],
  "buying_signals": ["short phrase describing a positive signal"],
  "score_signal": "PRICING_QUESTION",
  "suggested_action": "ANSWER_QUESTION",
  "confidence": 0.8
}

Allowed values for "intent" (pick exactly one): EXPLORING, LEARNING, PROBLEM_AWARE, SOLUTION_AWARE, DEMO_INTEREST, PURCHASE_INTEREST, READY_TO_BUY, NOT_INTERESTED.

Allowed values for each objection's "type" (pick exactly one per objection): PRICE, DECISION_MAKER, TIMING, TRUST, FEATURE_GAP, OTHER.

Allowed values for "score_signal" (pick exactly one, or the literal string "NONE" if nothing below applies): ${VALID_SIGNALS.join(', ')}, NONE.

Allowed values for "suggested_action" (pick exactly one — your best guess at what a sales agent should do next; this is advisory and may be overridden by a separate rules engine, so guess honestly rather than picking something safe): ${NBA_ACTIONS.join(', ')}.

Rules:
- "intent" reflects the lead's OVERALL apparent intent given this message and the conversation so far, not just this one line.
- "pain_points", "objections", and "buying_signals" may be empty arrays ([]) — do not invent content that isn't actually implied by the message. A bare acknowledgment ("ok", "yes", "thanks", a single emoji) with no new information implies none of these and score_signal should be "NONE" — replying at all is not by itself a signal worth scoring unless the reply's CONTENT matches one of the signals above.
- "score_signal" is the SINGLE most relevant signal for this specific message. Never invent a signal name outside the allowed list above.
- A question about cost/price/plans (asking WHAT something costs) is "PRICING_QUESTION" and intent "SOLUTION_AWARE" (they're evaluating a specific solution) — reserve PURCHASE_INTENT/READY_TO_BUY for when the lead is asking to actually proceed (sign up, pay, get started).
- General curiosity with no problem or solution mentioned yet ("what do you guys do?") is "EXPLORING", not "LEARNING" — use LEARNING only once they're asking to understand a specific concept, feature, or how something works in depth.
- "confidence" is your confidence in BOTH the "intent" and "suggested_action" choices together (0 = pure guess, 1 = certain) — one shared number, not two.
- Keep every "note" and phrase under 12 words — this is a quick tag, not a summary. Be terse so you finish well within the token budget.
- Never include text outside the JSON object.`;

/**
 * Calls Groq to extract structured lead-intelligence signals from a single
 * inbound message (with recent history for context), then merges the result
 * onto the Lead document: objections, pain points, intent (only if
 * confidence >= 0.5), and an incremental leadScore delta from
 * ScoringRuleConfig. Logs INTENT_CHANGED / LEAD_SCORE_CHANGED /
 * OBJECTION_DETECTED via logLeadEvent for whichever of those actually
 * changed.
 *
 * Never throws — wrapped in try/catch end to end. On any failure, logs a
 * best-effort LeadEvent note and returns null. This function is meant to be
 * called fire-and-forget (not awaited) by every agent's reply handler, so a
 * slow or failed Groq call can never delay or break the WhatsApp reply that
 * already went out — see the four call sites in services/inngest/functions.ts.
 */
export async function extractLeadIntelligence(
  leadId: string | mongoose.Types.ObjectId,
  messageText: string,
  conversationHistory: ConversationTurn[] = []
): Promise<ExtractionResult | null> {
  try {
    await dbConnect();

    const lead = await Lead.findById(leadId);
    if (!lead) {
      console.warn('[leadIntelligence] Lead not found:', String(leadId));
      return null;
    }

    const history = conversationHistory
      .slice(-10)
      .map((m) => `${m.role === 'lead' ? 'Lead' : 'Agent'}: ${m.text}`)
      .join('\n');
    const userContent = `Conversation so far (most recent last):\n${history || '(no prior history)'}\n\nLatest inbound message to classify:\n"${messageText}"`;

    let parsed: ExtractionResult | null = null;
    try {
      const res = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
        // Generous headroom: openai/gpt-oss-120b is a reasoning model that
        // spends tokens on internal reasoning before emitting the final
        // JSON — 500 was measured (golden-set run) to truncate mid-document
        // on several real inputs, especially anything with an objection.
        // The completion itself is tiny; this budget is for the reasoning,
        // not the output size.
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      });
      const raw = res.choices?.[0]?.message?.content?.trim();
      parsed = raw ? JSON.parse(raw) : null;
    } catch (err: any) {
      console.warn('[leadIntelligence] Groq extraction failed:', err?.message);
      // LeadEventType (Phase 1) has no generic failure/error type — this
      // phase doesn't add one, so MESSAGE_RECEIVED with an explicit
      // `failed: true` marker records that an extraction attempt happened
      // and didn't produce a result, without being misread as a real
      // INTENT_CHANGED/LEAD_SCORE_CHANGED/OBJECTION_DETECTED event.
      logLeadEvent(
        'MESSAGE_RECEIVED',
        { extractionFailed: true, reason: err?.message || 'unknown error' },
        'lead-intelligence',
        { leadId: lead._id, phone: lead.phone }
      );
      return null;
    }

    if (!parsed) return null;

    await applyExtraction(lead, parsed, messageText);
    return parsed;
  } catch (err: any) {
    console.warn('[leadIntelligence] extractLeadIntelligence failed:', err?.message);
    return null;
  }
}

async function getScoringRules(): Promise<Record<string, number>> {
  const config = await ScoringRuleConfig.findOne({ key: 'default' }).lean() as any;
  const rules = config?.rules?.length ? config.rules : DEFAULT_SCORING_RULES;
  const map: Record<string, number> = {};
  for (const r of rules as { signal: string; delta: number }[]) map[r.signal] = r.delta;
  return map;
}

/**
 * Exported (Phase 6) so services/demo/postDemoAnalysis.ts can reuse the
 * exact same intent/objections/pain-points/score merge logic for its own,
 * differently-shaped classification (demo outcome, not a per-message
 * intent/score_signal pair) — see that file for how it maps a demo outcome
 * onto this same ExtractionResult shape before calling this.
 */
export async function applyExtraction(lead: any, result: ExtractionResult, messageText: string): Promise<void> {
  const previousIntent = lead.intent || 'EXPLORING';
  const previousScore = typeof lead.leadScore === 'number' ? lead.leadScore : 0;
  let intentChanged = false;
  let scoreChanged = false;
  let objectionAdded = false;

  // --- Intent: only overwrite if the model is reasonably confident ---------
  const confidence = typeof result.confidence === 'number' ? result.confidence : 0;
  if (result.intent && VALID_INTENTS.includes(result.intent as Intent) && confidence >= 0.5) {
    if (result.intent !== previousIntent) {
      lead.intent = result.intent as Intent;
      intentChanged = true;
    }
  }

  // --- Objections: merge — append if this type has no open/unresolved -----
  // entry yet, otherwise update that entry's note rather than duplicating.
  if (Array.isArray(result.objections)) {
    lead.objections = lead.objections || [];
    for (const o of result.objections) {
      if (!o?.type || !VALID_OBJECTION_TYPES.includes(o.type as ObjectionType)) continue;
      const existingOpen = lead.objections.find((existing: any) => existing.type === o.type && !existing.resolved);
      if (existingOpen) {
        if (o.note) existingOpen.note = o.note;
      } else {
        lead.objections.push({ type: o.type, note: o.note, detectedAt: new Date(), resolved: false });
        objectionAdded = true;
      }
    }
  }

  // --- Pain points: append + dedupe (case-insensitive) ---------------------
  if (Array.isArray(result.pain_points) && result.pain_points.length) {
    const existing = new Set((lead.painPoints || []).map((p: string) => p.toLowerCase().trim()));
    const merged = [...(lead.painPoints || [])];
    for (const p of result.pain_points) {
      const clean = (p || '').trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (!existing.has(key)) {
        merged.push(clean);
        existing.add(key);
      }
    }
    lead.painPoints = merged;
  }

  // --- Score: apply the single signal's delta, clamped 0-100 ---------------
  // REPLIED is capped once/day per the ScoringRuleConfig spec — enforced
  // here explicitly rather than left to the model's discretion, since an
  // LLM-decided signal has no reliable memory of "already scored today."
  const isReplyCapExhausted =
    result.score_signal === 'REPLIED' &&
    lead.lastRepliedScoreAt &&
    isSameCalendarDay(lead.lastRepliedScoreAt, new Date());

  if (result.score_signal && result.score_signal !== 'NONE' && !isReplyCapExhausted) {
    const rules = await getScoringRules();
    const delta = rules[result.score_signal];
    if (typeof delta === 'number') {
      const nextScore = Math.min(100, Math.max(0, previousScore + delta));
      if (nextScore !== previousScore) {
        lead.leadScore = nextScore;
        scoreChanged = true;
        if (result.score_signal === 'REPLIED') lead.lastRepliedScoreAt = new Date();
      }
    }
  }

  // --- Meaningful interaction timestamp -------------------------------------
  if (isSubstantiveMessage(messageText)) {
    lead.lastMeaningfulInteractionAt = new Date();
  }

  // --- Phase 8: rolling confidence window for the human-handoff trigger -----
  // Kept to the last 2 entries — that's all checkHandoffTriggers.ts's
  // "two consecutive low-confidence turns" rule needs.
  const recentConfidences = [...(lead.recentExtractionConfidences || []), confidence].slice(-2);
  lead.recentExtractionConfidences = recentConfidences;

  await lead.save();

  if (intentChanged) {
    logLeadEvent(
      'INTENT_CHANGED',
      { from: previousIntent, to: lead.intent, confidence },
      'lead-intelligence',
      { leadId: lead._id, phone: lead.phone }
    );
  }
  if (scoreChanged) {
    logLeadEvent(
      'LEAD_SCORE_CHANGED',
      { from: previousScore, to: lead.leadScore, signal: result.score_signal },
      'lead-intelligence',
      { leadId: lead._id, phone: lead.phone }
    );
  }
  if (objectionAdded) {
    logLeadEvent(
      'OBJECTION_DETECTED',
      { objections: result.objections },
      'lead-intelligence',
      { leadId: lead._id, phone: lead.phone }
    );
  }

  // Decision-only — see decideNextAction's own doc comment. This computes
  // and stores Lead.nextBestAction/nextActionAt; it does NOT send anything.
  // Passed the already-saved `lead` doc directly (not re-fetched by id) so
  // this reads the state applyExtraction just wrote, not a stale copy.
  try {
    await decideNextAction(lead, { suggested_action: result.suggested_action, confidence });
  } catch (err: any) {
    console.warn('[leadIntelligence] decideNextAction failed:', err?.message);
  }
}
