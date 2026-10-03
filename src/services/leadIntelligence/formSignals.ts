import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import ScoringRuleConfig, { DEFAULT_SCORING_RULES } from '@/models/ScoringRuleConfig';
import { logLeadEvent } from '@/services/leadEvents';
import {
  alreadyScored,
  behavioralSignature,
  withScoredSignature,
} from '@/services/leadIntelligence/scoringIdempotency';

/**
 * Form-submit scoring that reuses the same ScoringRuleConfig deltas and
 * scoredSignalKeys idempotency as chat extraction. Used by free-report and
 * book-demo so those routes do not embed scoring math.
 *
 * messageKey must be stable across retries for the same logical submit
 * (e.g. "free-report" or "book-demo") so a double submit of the same form
 * does not stack another +N.
 */
export async function applyFormSignal(
  leadId: string | mongoose.Types.ObjectId,
  signal: string,
  messageKey: string
): Promise<{ applied: boolean; from: number; to: number }> {
  await dbConnect();
  const lead = await Lead.findById(leadId);
  if (!lead) return { applied: false, from: 0, to: 0 };

  const previousScore = typeof lead.leadScore === 'number' ? lead.leadScore : 0;
  const signature = behavioralSignature(signal, messageKey);
  if (signature && alreadyScored(lead.scoredSignalKeys, signature)) {
    return { applied: false, from: previousScore, to: previousScore };
  }

  const config = await ScoringRuleConfig.findOne({ key: 'default' }).lean() as any;
  const rules = config?.rules?.length ? config.rules : DEFAULT_SCORING_RULES;
  const delta = (rules as { signal: string; delta: number }[]).find((r) => r.signal === signal)?.delta;
  if (typeof delta !== 'number') {
    return { applied: false, from: previousScore, to: previousScore };
  }

  const nextScore = Math.min(100, Math.max(0, previousScore + delta));
  if (signature) {
    lead.scoredSignalKeys = withScoredSignature(lead.scoredSignalKeys, signature);
  }
  if (nextScore !== previousScore) {
    lead.leadScore = nextScore;
  }
  await lead.save();

  if (nextScore !== previousScore) {
    logLeadEvent(
      'LEAD_SCORE_CHANGED',
      { from: previousScore, to: nextScore, signal, source: 'form' },
      'form-signal',
      { leadId: lead._id, phone: lead.phone }
    );
  }

  return { applied: nextScore !== previousScore, from: previousScore, to: nextScore };
}
