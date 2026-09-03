import Groq from 'groq-sdk';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { GROQ_MODEL } from '@/lib/aiModel';
import Lead from '@/models/Lead';
import { applyExtraction } from '@/services/leadIntelligence/extract';
import { setLeadOwnership } from '@/services/leadOwnership/setLeadOwnership';
import { logLeadEvent } from '@/services/leadEvents';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export const DEMO_OUTCOMES = [
  'HIGH_INTEREST',
  'PRICE_CONCERN',
  'NEEDS_MORE_INFORMATION',
  'NEEDS_APPROVAL',
  'NOT_READY',
  'NOT_INTERESTED',
  'NO_SHOW',
  'RESCHEDULE_REQUIRED',
] as const;
export type DemoOutcome = (typeof DEMO_OUTCOMES)[number];

/**
 * Maps a post-demo outcome onto Phase 3's ExtractionResult shape (intent +
 * score_signal + an optional objection) so applyExtraction() — the SAME
 * merge logic Phase 3 already uses for per-message extraction — can be
 * reused verbatim rather than re-implementing intent/score/objection
 * merging a second time for this differently-shaped input. NO_SHOW and
 * RESCHEDULE_REQUIRED intentionally don't move intent (a no-show or
 * reschedule says nothing new about buying intent) or score (no scoring
 * signal in ScoringRuleConfig models "didn't show up").
 */
function outcomeToExtractionResult(outcome: DemoOutcome, confidence: number): {
  intent?: string;
  score_signal?: string;
  objections?: { type: string; note: string }[];
} {
  switch (outcome) {
    case 'HIGH_INTEREST':
      return { intent: 'PURCHASE_INTEREST', score_signal: 'DEMO_ATTENDED' };
    case 'PRICE_CONCERN':
      return { intent: 'SOLUTION_AWARE', score_signal: 'DEMO_ATTENDED', objections: [{ type: 'PRICE', note: 'raised during demo' }] };
    case 'NEEDS_MORE_INFORMATION':
      return { intent: 'SOLUTION_AWARE', score_signal: 'DEMO_ATTENDED' };
    case 'NEEDS_APPROVAL':
      return { intent: 'SOLUTION_AWARE', score_signal: 'DEMO_ATTENDED', objections: [{ type: 'DECISION_MAKER', note: 'needs internal approval' }] };
    case 'NOT_READY':
      return { intent: 'SOLUTION_AWARE', score_signal: 'DEMO_ATTENDED', objections: [{ type: 'TIMING', note: 'not ready yet' }] };
    case 'NOT_INTERESTED':
      return { intent: 'NOT_INTERESTED', score_signal: 'EXPLICIT_REJECTION' };
    case 'NO_SHOW':
    case 'RESCHEDULE_REQUIRED':
      return {};
  }
}

const ANALYSIS_SYSTEM_PROMPT = `You analyze a completed WhatsApp conversation between a sales/demo prospect and a booking agent, AFTER their demo has happened, and classify the outcome.

Respond with a SINGLE JSON object and NOTHING else, matching this example shape exactly (keys and types, not these literal values):
{
  "outcome": "HIGH_INTEREST",
  "summary": "one short sentence on why you picked this outcome",
  "confidence": 0.8
}

Allowed values for "outcome" (pick exactly one): ${DEMO_OUTCOMES.join(', ')}.

Guidance on each outcome:
- HIGH_INTEREST: the prospect showed clear enthusiasm, asked about next steps or signing up.
- PRICE_CONCERN: cost/pricing was raised as a sticking point.
- NEEDS_MORE_INFORMATION: they want more details/a follow-up before deciding.
- NEEDS_APPROVAL: they need a partner/manager/decision-maker to sign off.
- NOT_READY: interested in principle but the timing is wrong (too early, too busy, revisit later).
- NOT_INTERESTED: they explicitly said no or showed no interest.
- NO_SHOW / RESCHEDULE_REQUIRED: only use these if the conversation itself says so explicitly (e.g. they asked to reschedule) — don't guess these from silence; the caller sets NO_SHOW directly when nobody joined, not from this classification.

Rules:
- Base your answer only on what's actually in the conversation — never invent detail that isn't there.
- "confidence" is your confidence in the "outcome" choice (0 = pure guess, 1 = certain).
- Never include text outside the JSON object.`;

export interface PostDemoAnalysisResult {
  outcome: DemoOutcome;
  summary?: string;
  confidence: number;
}

/**
 * Runs the Groq structured-extraction pattern from Phase 3 (response_format
 * json_object) against a completed demo's conversation history, classifying
 * it into one of DEMO_OUTCOMES. Updates Lead.intent/objections/leadScore via
 * the SAME merge logic Phase 3 already uses (see outcomeToExtractionResult
 * above), sets Lead.currentStage='DEMO_COMPLETED', and hands ownership back
 * to SALES via setLeadOwnership — mirroring exactly what the task specifies.
 *
 * Never throws — same "never fail the workflow" contract as every other
 * best-effort analysis step in this codebase. On any failure, logs a
 * best-effort LeadEvent note and returns null; the caller (the admin
 * "mark complete" route, or the no-show scheduled check) still proceeds
 * with its own status update regardless of whether this analysis succeeds.
 */
export async function runPostDemoAnalysis(
  leadId: string | mongoose.Types.ObjectId,
  conversationHistory: { role: 'lead' | 'agent'; text: string }[],
  forcedOutcome?: DemoOutcome
): Promise<PostDemoAnalysisResult | null> {
  try {
    await dbConnect();
    const lead = await Lead.findById(leadId);
    if (!lead) {
      console.warn('[postDemoAnalysis] Lead not found:', String(leadId));
      return null;
    }

    let analysis: PostDemoAnalysisResult;
    if (forcedOutcome) {
      // The no-show path (functions.ts's nurtureSchedulerTick NO_SHOW_CHECK
      // branch) already KNOWS the outcome — no need to ask Groq to guess it
      // from an empty/inconclusive conversation.
      analysis = { outcome: forcedOutcome, confidence: 1 };
    } else {
      const history = conversationHistory
        .slice(-30)
        .map((m) => `${m.role === 'lead' ? 'Prospect' : 'Agent'}: ${m.text}`)
        .join('\n');
      const userContent = `Full demo conversation:\n${history || '(no conversation recorded)'}`;

      try {
        const res = await groq.chat.completions.create({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          temperature: 0.2,
          max_tokens: 1000,
          response_format: { type: 'json_object' },
        });
        const raw = res.choices?.[0]?.message?.content?.trim();
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed?.outcome || !DEMO_OUTCOMES.includes(parsed.outcome)) {
          throw new Error(`model returned an invalid outcome: ${parsed?.outcome}`);
        }
        analysis = {
          outcome: parsed.outcome,
          summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        };
      } catch (err: any) {
        console.warn('[postDemoAnalysis] Groq analysis failed:', err?.message);
        logLeadEvent(
          'MESSAGE_RECEIVED', // see extract.ts's own comment: LeadEventType has no generic failure type
          { extractionFailed: true, context: 'post-demo-analysis', reason: err?.message || 'unknown error' },
          'demo-agent',
          { leadId: lead._id, phone: lead.phone }
        );
        return null;
      }
    }

    // Reuse Phase 3's exact merge logic for intent/objections/score.
    const mapped = outcomeToExtractionResult(analysis.outcome, analysis.confidence);
    await applyExtraction(
      lead,
      { intent: mapped.intent, score_signal: mapped.score_signal, objections: mapped.objections, confidence: analysis.confidence },
      analysis.summary || `Post-demo outcome: ${analysis.outcome}`
    );

    // applyExtraction() already saved `lead` — re-set currentStage and hand
    // ownership back to SALES via setLeadOwnership (the single write-path
    // for both fields — see its own doc comment).
    await setLeadOwnership(lead._id, 'SALES', 'demo-completed', 'demo-agent', 'DEMO_COMPLETED');

    logLeadEvent(
      'DEMO_COMPLETED',
      { outcome: analysis.outcome, summary: analysis.summary, confidence: analysis.confidence },
      'demo-agent',
      { leadId: lead._id, phone: lead.phone }
    );

    return analysis;
  } catch (err: any) {
    console.warn('[postDemoAnalysis] runPostDemoAnalysis failed:', err?.message);
    return null;
  }
}
