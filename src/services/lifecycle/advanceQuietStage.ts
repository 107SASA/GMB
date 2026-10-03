import type { LeadStage } from '@/services/nba/rules';

export interface QuietStageInput {
  currentStage: string | null | undefined;
  currentAgent: string | null | undefined;
  nurtureStatus: string | null | undefined;
  humanHandoffActive?: boolean;
  /** Follow-ups already sent on the sales conversation. */
  followUpsSent: number;
  /** Total follow-up steps configured on SalesAgentConfig. */
  followUpCount: number;
  /** Last delayHours from the configured followUps array (default 72). */
  lastDelayHours: number;
  /** When the last proactive follow-up / agent message was sent. */
  lastAgentAt: Date | null | undefined;
  /** When the lead last replied (if ever). */
  lastLeadReplyAt: Date | null | undefined;
  now?: Date;
}

/**
 * Pure: given existing sales follow-up timing, decide whether a silent
 * NURTURING lead should move to UNRESPONSIVE, or UNRESPONSIVE to
 * LONG_TERM_NURTURE. Never invents delays — uses the config's last
 * delayHours. Returns null when no transition should happen.
 *
 * Progression (from LEAD_SALES_IMPLEMENTATION_PLAN.md):
 *   NURTURING → (all follow-ups sent, no reply, lastDelayHours since last agent) → UNRESPONSIVE
 *   UNRESPONSIVE → (another lastDelayHours with no reply) → LONG_TERM_NURTURE
 */
export function advanceQuietStage(input: QuietStageInput): LeadStage | null {
  if (input.humanHandoffActive) return null;
  if (input.currentAgent === 'HUMAN') return null;
  if (input.nurtureStatus === 'OPTED_OUT' || input.nurtureStatus === 'STOPPED') return null;
  if (input.currentAgent === 'IN_HOUSE') return null;

  const stage = input.currentStage || 'NEW';
  if (stage === 'CUSTOMER' || stage === 'DO_NOT_CONTACT' || stage === 'LOST' || stage === 'HUMAN_HANDOFF') {
    return null;
  }
  if (stage === 'LONG_TERM_NURTURE') return null;

  // A reply after follow-ups started means they are not silent.
  if (input.lastLeadReplyAt) return null;

  const now = input.now || new Date();
  const lastAgent = input.lastAgentAt ? new Date(input.lastAgentAt).getTime() : NaN;
  if (!Number.isFinite(lastAgent)) return null;

  const waitMs = Math.max(1, input.lastDelayHours) * 60 * 60 * 1000;
  const quietLongEnough = now.getTime() - lastAgent >= waitMs;
  if (!quietLongEnough) return null;

  if (stage === 'NURTURING' || stage === 'QUALIFYING' || stage === 'NEW') {
    // Only advance after the configured drip has finished sending.
    if (input.followUpCount > 0 && input.followUpsSent < input.followUpCount) return null;
    return 'UNRESPONSIVE';
  }

  if (stage === 'UNRESPONSIVE') {
    return 'LONG_TERM_NURTURE';
  }

  return null;
}
