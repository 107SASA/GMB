/**
 * Config-driven next-best-action rule table. A plain array of data, not
 * if/else decision logic — decideNextAction.ts's job is to find every row
 * that matches a lead's current state and union their legalActions; this
 * file's job is only to hold that data so a rule can be added/edited
 * without touching decision logic (see the task's own framing).
 *
 * Row-matching semantics (all conditions on a row are AND'd together):
 *   - currentStage: required, must equal Lead.currentStage exactly, OR the
 *     literal 'ANY' to match every stage (used for intent-override rows —
 *     explicit purchase/demo intent applies regardless of stage).
 *   - intentIn: optional — if present, Lead.intent must be one of these.
 *   - scoreBand: optional — if present, the lead's computed scoreBand (see
 *     computeScoreBand below) must equal this, OR the literal 'ANY'.
 *   - hasOpenObjection: optional — if present, must match whether the lead
 *     has at least one unresolved objection.
 *   - currentAgent: optional — if present, must equal Lead.currentAgent, OR
 *     the literal 'ANY'. Used for the HUMAN-ownership row.
 *   - nurtureStatus: optional — if present, must equal Lead.nurtureStatus.
 *
 * When multiple rows match, decideNextAction unions their legalActions and
 * uses the FIRST matching row's defaultAction as the fallback default — so
 * row order matters for the default (but not for the legal set). The
 * override rows (HUMAN ownership, opted-out/do-not-contact, explicit
 * purchase/demo intent) are listed first so they win the default slot
 * whenever they match, exactly as the task specifies ("explicit intent
 * wins" / "AI must never act while human owns the lead").
 */

export type NBAAction =
  | 'ASK_QUALIFICATION'
  | 'EDUCATE'
  | 'SHARE_USE_CASE'
  | 'ANSWER_QUESTION'
  | 'HANDLE_OBJECTION'
  | 'SHOW_VALUE'
  | 'OFFER_DEMO'
  | 'SCHEDULE_DEMO'
  | 'SEND_PRICING'
  | 'FOLLOW_UP_AFTER_DEMO'
  | 'OFFER_SUBSCRIPTION'
  | 'REENGAGE'
  | 'WAIT'
  | 'HUMAN_HANDOFF'
  | 'STOP';

export const NBA_ACTIONS: NBAAction[] = [
  'ASK_QUALIFICATION', 'EDUCATE', 'SHARE_USE_CASE', 'ANSWER_QUESTION',
  'HANDLE_OBJECTION', 'SHOW_VALUE', 'OFFER_DEMO', 'SCHEDULE_DEMO',
  'SEND_PRICING', 'FOLLOW_UP_AFTER_DEMO', 'OFFER_SUBSCRIPTION',
  'REENGAGE', 'WAIT', 'HUMAN_HANDOFF', 'STOP',
];

export type LeadStage =
  | 'NEW' | 'QUALIFYING' | 'NURTURING' | 'DEMO_REQUESTED' | 'DEMO_SCHEDULED'
  | 'DEMO_COMPLETED' | 'CONVERSION_PENDING' | 'PAYMENT_VERIFIED' | 'CUSTOMER'
  | 'COLD' | 'UNRESPONSIVE' | 'LONG_TERM_NURTURE' | 'LOST' | 'DO_NOT_CONTACT'
  | 'HUMAN_HANDOFF';

export type LeadIntent =
  | 'EXPLORING' | 'LEARNING' | 'PROBLEM_AWARE' | 'SOLUTION_AWARE'
  | 'DEMO_INTEREST' | 'PURCHASE_INTEREST' | 'READY_TO_BUY' | 'NOT_INTERESTED';

export type LeadAgent = 'NONE' | 'SALES' | 'DEMO' | 'IN_HOUSE' | 'HUMAN';
export type NurtureStatus = 'ACTIVE' | 'PAUSED' | 'STOPPED' | 'OPTED_OUT';

export type ScoreBand = 'COLD' | 'WARM' | 'HOT' | 'READY';

/**
 * leadScore (0-100) → a coarse band the rule table can key off. Boundaries
 * are a judgment call (not specified by the task) chosen as a simple,
 * documented, editable split rather than buried magic numbers — tune here
 * if real data suggests different cutoffs. Order matches ScoringRuleConfig's
 * biggest single deltas (DEMO_REQUESTED/BOOKED/PURCHASE_INTENT are +20/+20/
 * +25), so a single strong signal from 0 is enough to reach WARM, and two
 * are enough to approach READY.
 */
export function computeScoreBand(leadScore: number | undefined | null): ScoreBand {
  const score = typeof leadScore === 'number' ? leadScore : 0;
  if (score >= 75) return 'READY';
  if (score >= 45) return 'HOT';
  if (score >= 15) return 'WARM';
  return 'COLD';
}

export interface NBARuleInput {
  currentStage: LeadStage;
  intent?: LeadIntent;
  scoreBand: ScoreBand;
  hasOpenObjection: boolean;
  currentAgent: LeadAgent;
  nurtureStatus: NurtureStatus;
}

export interface NBARule {
  /** Human-readable label, shown in NBA_OVERRIDDEN / debugging output only. */
  name: string;
  currentStage: LeadStage | 'ANY';
  intentIn?: LeadIntent[];
  scoreBand?: ScoreBand | 'ANY';
  hasOpenObjection?: boolean | 'ANY';
  currentAgent?: LeadAgent | 'ANY';
  nurtureStatus?: NurtureStatus | 'ANY';
  legalActions: NBAAction[];
  defaultAction: NBAAction;
  /**
   * When true, this rule's legalActions become the ENTIRE legal set the
   * moment it matches — not unioned with any other matching row — and no
   * LLM suggestion can escape it regardless of confidence. Reserved for the
   * two hard-stop rules the task specifies as "always" (opted-out/
   * do-not-contact → STOP only; currentAgent=HUMAN → WAIT only). Without
   * this, a plain union would let e.g. an also-matching "explicit purchase
   * intent" row (currentStage: 'ANY') leak OFFER_SUBSCRIPTION into the
   * legal set for a lead a human currently owns — exactly the bug this
   * flag exists to prevent. If more than one absolute rule matches (should
   * not happen with the rows below, but defensively), the first one found
   * wins outright.
   */
  absolute?: boolean;
}

/**
 * Listed in priority order for the DEFAULT action (see file-level comment):
 * hard-stop/ownership rules first, then explicit-intent overrides, then
 * stage-based progression. legalActions from every matching row are always
 * unioned regardless of order — order only decides whose defaultAction wins.
 */
export const NBA_RULES: NBARule[] = [
  // --- Hard stops — always win, never overridden by an LLM suggestion ------
  // NOTE: these are two separate rows, not one row with nurtureStatus:'ANY'
  // + currentStage:'ANY' — a single row's conditions are AND'd together (see
  // matchesCondition below), so "opted out OR do-not-contact" genuinely
  // needs two rows to express that OR. A single row with both set to 'ANY'
  // would match every lead unconditionally, since 'ANY' always matches.
  {
    name: 'Opted out',
    currentStage: 'ANY',
    nurtureStatus: 'OPTED_OUT',
    legalActions: ['STOP'],
    defaultAction: 'STOP',
    absolute: true,
  },
  {
    name: 'Do-not-contact stage',
    currentStage: 'DO_NOT_CONTACT',
    legalActions: ['STOP'],
    defaultAction: 'STOP',
    absolute: true,
  },
  {
    name: 'Human owns this lead',
    currentStage: 'ANY',
    currentAgent: 'HUMAN',
    legalActions: ['WAIT'],
    defaultAction: 'WAIT',
    absolute: true,
  },

  // --- Explicit-intent overrides — win over score/stage progression --------
  {
    name: 'Explicit purchase intent overrides stage/score progression',
    currentStage: 'ANY',
    intentIn: ['PURCHASE_INTEREST', 'READY_TO_BUY'],
    legalActions: ['OFFER_SUBSCRIPTION', 'SEND_PRICING', 'ANSWER_QUESTION'],
    defaultAction: 'OFFER_SUBSCRIPTION',
  },

  // --- Demo-specific stage rows, BEFORE the generic demo-intent override ----
  // below on purpose: once a demo has actually been requested/scheduled/
  // completed, the stage-specific row (SCHEDULE_DEMO / WAIT /
  // FOLLOW_UP_AFTER_DEMO) is the correct default, not "offer a demo" again —
  // that would be wrong the moment the lead has already said yes. Only a
  // lead who has NOT yet reached one of those stages should default to
  // OFFER_DEMO from the generic override further down. legalActions still
  // union normally regardless of this ordering — only the DEFAULT changes.
  {
    name: 'Demo requested, not yet scheduled',
    currentStage: 'DEMO_REQUESTED',
    legalActions: ['SCHEDULE_DEMO', 'ANSWER_QUESTION'],
    defaultAction: 'SCHEDULE_DEMO',
  },
  {
    name: 'Demo scheduled — nothing to do but wait or answer questions',
    currentStage: 'DEMO_SCHEDULED',
    legalActions: ['WAIT', 'ANSWER_QUESTION'],
    defaultAction: 'WAIT',
  },
  {
    name: 'Demo completed',
    currentStage: 'DEMO_COMPLETED',
    legalActions: ['FOLLOW_UP_AFTER_DEMO', 'SEND_PRICING', 'HANDLE_OBJECTION'],
    defaultAction: 'FOLLOW_UP_AFTER_DEMO',
  },
  {
    name: 'Explicit demo interest (lead has not yet reached a demo-in-progress stage)',
    currentStage: 'ANY',
    intentIn: ['DEMO_INTEREST'],
    legalActions: ['OFFER_DEMO', 'SCHEDULE_DEMO'],
    defaultAction: 'OFFER_DEMO',
  },

  // --- Stage-based progression ----------------------------------------------
  {
    name: 'Open objection during nurture — handle it, not generic follow-up',
    currentStage: 'NURTURING',
    hasOpenObjection: true,
    legalActions: ['HANDLE_OBJECTION', 'SHOW_VALUE', 'WAIT'],
    defaultAction: 'HANDLE_OBJECTION',
  },
  {
    name: 'New or qualifying lead',
    currentStage: 'NEW',
    legalActions: ['ASK_QUALIFICATION', 'EDUCATE', 'ANSWER_QUESTION'],
    defaultAction: 'ASK_QUALIFICATION',
  },
  {
    name: 'New or qualifying lead',
    currentStage: 'QUALIFYING',
    legalActions: ['ASK_QUALIFICATION', 'EDUCATE', 'ANSWER_QUESTION'],
    defaultAction: 'ASK_QUALIFICATION',
  },
  {
    name: 'Nurturing, no open objection',
    currentStage: 'NURTURING',
    hasOpenObjection: false,
    legalActions: ['EDUCATE', 'SHARE_USE_CASE', 'SHOW_VALUE', 'ANSWER_QUESTION', 'OFFER_DEMO'],
    defaultAction: 'SHOW_VALUE',
  },
  {
    name: 'Conversion pending — awaiting payment',
    currentStage: 'CONVERSION_PENDING',
    legalActions: ['OFFER_SUBSCRIPTION', 'SEND_PRICING', 'ANSWER_QUESTION', 'HANDLE_OBJECTION'],
    defaultAction: 'OFFER_SUBSCRIPTION',
  },
  {
    name: 'Payment verified — handing to in-house/customer flow',
    currentStage: 'PAYMENT_VERIFIED',
    legalActions: ['WAIT', 'HUMAN_HANDOFF'],
    defaultAction: 'WAIT',
  },
  {
    name: 'Already a customer — AI sales nurture has nothing left to do',
    currentStage: 'CUSTOMER',
    legalActions: ['WAIT'],
    defaultAction: 'WAIT',
  },
  {
    name: 'Cold lead',
    currentStage: 'COLD',
    legalActions: ['REENGAGE', 'WAIT'],
    defaultAction: 'REENGAGE',
  },
  {
    name: 'Unresponsive lead',
    currentStage: 'UNRESPONSIVE',
    legalActions: ['REENGAGE', 'WAIT'],
    defaultAction: 'WAIT',
  },
  {
    name: 'Long-term nurture',
    currentStage: 'LONG_TERM_NURTURE',
    legalActions: ['REENGAGE', 'SHARE_USE_CASE', 'WAIT'],
    defaultAction: 'WAIT',
  },
  {
    name: 'Lost lead — nothing legal but stopping outreach',
    currentStage: 'LOST',
    legalActions: ['STOP', 'WAIT'],
    defaultAction: 'WAIT',
  },
  {
    name: 'Human-handoff stage (belt-and-suspenders with the currentAgent=HUMAN rule above)',
    currentStage: 'HUMAN_HANDOFF',
    legalActions: ['WAIT', 'HUMAN_HANDOFF'],
    defaultAction: 'WAIT',
  },
];

function matchesCondition<T>(ruleValue: T | 'ANY' | undefined, actual: T): boolean {
  if (ruleValue === undefined) return true; // condition not specified on this row — always matches
  if (ruleValue === 'ANY') return true;
  return ruleValue === actual;
}

/** Returns every rule row whose conditions all match the given lead state. */
export function findMatchingRules(input: NBARuleInput): NBARule[] {
  return NBA_RULES.filter((rule) => {
    if (!matchesCondition(rule.currentStage, input.currentStage)) return false;
    if (rule.intentIn && (!input.intent || !rule.intentIn.includes(input.intent))) return false;
    if (!matchesCondition(rule.scoreBand, input.scoreBand)) return false;
    if (!matchesCondition(rule.hasOpenObjection, input.hasOpenObjection)) return false;
    if (!matchesCondition(rule.currentAgent, input.currentAgent)) return false;
    if (!matchesCondition(rule.nurtureStatus, input.nurtureStatus)) return false;
    return true;
  });
}
