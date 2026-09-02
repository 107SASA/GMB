import dbConnect from '@/lib/mongodb';
import Lead, { type ILead } from '@/models/Lead';
import { logLeadEvent } from '@/services/leadEvents';
import {
  computeScoreBand,
  findMatchingRules,
  NBA_ACTIONS,
  type NBAAction,
  type NBARuleInput,
} from './rules';

/**
 * The subset of Phase 3's extraction output this decision engine reads.
 * suggested_action/confidence are the new fields this phase adds to that
 * contract (see extract.ts) — kept as its own small interface here so this
 * file doesn't need to import extract.ts's full (larger) ExtractionResult
 * shape just for two fields.
 */
export interface LLMActionSuggestion {
  suggested_action?: string;
  confidence?: number;
}

export interface DecideNextActionResult {
  action: NBAAction;
  legalActions: NBAAction[];
  usedLLMSuggestion: boolean;
  overridden: boolean;
}

/**
 * Decision-only. Phase 4 does NOT send anything because of this — it only
 * computes and stores Lead.nextBestAction/nextActionAt. A later phase reads
 * these fields to actually act; per the ownership-engine convention
 * established in Phase 2, that future phase must gate itself on
 * process.env.LEAD_ENGINE_V2 === 'true' before treating nextBestAction as
 * authoritative for anything user-facing.
 *
 * Looks up every NBA_RULES row matching the lead's current
 * stage/intent/scoreBand/hasOpenObjection/currentAgent/nurtureStatus, unions
 * their legalActions, and picks:
 *   - the LLM's suggested_action, if given AND it's a member of the legal
 *     set AND confidence >= 0.5; otherwise
 *   - the (first matching rule's) defaultAction, logging NBA_OVERRIDDEN if
 *     the LLM had suggested something that got rejected.
 *
 * Sets Lead.nextBestAction and Lead.nextActionAt = now (immediate — this
 * phase doesn't compute a proactive-nurture delay; see the task's own
 * "for this phase just set nextActionAt = now" instruction) and saves.
 *
 * Accepts either a full ILead document or a plain id — resolves to the
 * document either way so callers already holding a fresh in-memory lead
 * (e.g. right after extractLeadIntelligence just saved it) don't pay a
 * redundant round-trip, while callers that only have an id can still call
 * this directly.
 */
export async function decideNextAction(
  lead: ILead | string,
  llmOutput: LLMActionSuggestion = {}
): Promise<DecideNextActionResult> {
  await dbConnect();
  const doc = typeof lead === 'string' ? await Lead.findById(lead) : lead;
  if (!doc) {
    throw new Error(`decideNextAction: Lead not found: ${String(lead)}`);
  }

  const hasOpenObjection = (doc.objections || []).some((o: { resolved: boolean }) => !o.resolved);
  const ruleInput: NBARuleInput = {
    currentStage: (doc.currentStage || 'NEW') as NBARuleInput['currentStage'],
    intent: doc.intent as NBARuleInput['intent'],
    scoreBand: computeScoreBand(doc.leadScore),
    hasOpenObjection,
    currentAgent: (doc.currentAgent || 'NONE') as NBARuleInput['currentAgent'],
    nurtureStatus: (doc.nurtureStatus || 'ACTIVE') as NBARuleInput['nurtureStatus'],
  };

  const matches = findMatchingRules(ruleInput);

  // An `absolute` rule (HUMAN ownership, opted-out/do-not-contact) fully
  // overrides everything else the moment it matches — its legalActions
  // become the ENTIRE set, not unioned with any other matching row (e.g.
  // the always-matching "explicit purchase intent" row for currentStage:
  // 'ANY'). See NBARule.absolute's doc comment for why a plain union can't
  // express "always, no exceptions."
  const absoluteMatch = matches.find((r) => r.absolute);

  // Every lead state matches at least a stage-based row today (NBA_RULES
  // covers all 15 currentStage values), but fall back to WAIT defensively
  // rather than throwing if some future stage value slips through with no
  // matching row — WAIT is always the safe default (never sends anything).
  const legalActions = absoluteMatch
    ? [...absoluteMatch.legalActions]
    : matches.length
      ? [...new Set(matches.flatMap((r) => r.legalActions))]
      : (['WAIT'] as NBAAction[]);
  const fallbackDefault: NBAAction = absoluteMatch?.defaultAction ?? matches[0]?.defaultAction ?? 'WAIT';

  const suggested = llmOutput.suggested_action;
  const confidence = typeof llmOutput.confidence === 'number' ? llmOutput.confidence : 0;
  const suggestionIsLegal = Boolean(suggested) && NBA_ACTIONS.includes(suggested as NBAAction) && legalActions.includes(suggested as NBAAction);

  let action: NBAAction;
  let usedLLMSuggestion = false;
  let overridden = false;

  if (suggestionIsLegal && confidence >= 0.5) {
    action = suggested as NBAAction;
    usedLLMSuggestion = true;
  } else {
    action = fallbackDefault;
    if (suggested) {
      // The LLM proposed something but it was rejected — either illegal for
      // this lead's state, or legal but under-confident. Both cases are a
      // real override worth recording.
      overridden = true;
    }
  }

  doc.nextBestAction = action;
  doc.nextActionAt = new Date();
  await doc.save();

  if (overridden) {
    const reason = !NBA_ACTIONS.includes(suggested as NBAAction)
      ? 'not_a_valid_action'
      : !legalActions.includes(suggested as NBAAction)
        ? 'illegal_for_current_state'
        : 'confidence_below_threshold';
    logLeadEvent(
      'NBA_OVERRIDDEN',
      { suggested, used: action, reason, confidence, legalActions },
      'nba-engine',
      { leadId: doc._id, phone: doc.phone }
    );
  }

  return { action, legalActions, usedLLMSuggestion, overridden };
}
