import type { ILead } from '@/models/Lead';

/**
 * Single, shared definition of "this lead must not receive an AI-generated
 * message right now" — used as the P0 safety gate by every live agent
 * (Sales, Booking/Demo, Support, Report) and the legacy followUpCron/
 * processFollowUpJob system, so all of them agree on exactly one
 * definition rather than each re-deriving a slightly different check.
 *
 * True when EITHER:
 *   - currentAgent === 'HUMAN' (the ownership model's own record of who
 *     currently owns this lead — the authoritative signal), OR
 *   - humanHandoff.active === true (belt-and-braces: covers the moment
 *     between a handoff being recorded and currentAgent finishing its
 *     write, and any future code path that ever sets one without the
 *     other in perfect lockstep).
 *
 * Deliberately does NOT check nurtureStatus/currentStage here — opt-out
 * and do-not-contact are a related but distinct concern (see
 * isOptedOutOrDoNotContact below); callers that need both checks call both,
 * so each function's name says exactly what it checks.
 */
export function isHumanOwned(lead: Pick<ILead, 'currentAgent' | 'humanHandoff'> | null | undefined): boolean {
  if (!lead) return false;
  return lead.currentAgent === 'HUMAN' || lead.humanHandoff?.active === true;
}

/**
 * True when the lead has explicitly opted out or been marked do-not-contact
 * via the CURRENT ownership model's own fields — checked separately from
 * isHumanOwned so a caller (like the legacy follow-up cron) that needs both
 * safety properties can express that clearly, and so this doesn't silently
 * grow to mean something different from what its name says.
 */
export function isOptedOutOrDoNotContact(lead: Pick<ILead, 'nurtureStatus' | 'currentStage'> | null | undefined): boolean {
  if (!lead) return false;
  return (
    lead.nurtureStatus === 'OPTED_OUT' ||
    lead.nurtureStatus === 'STOPPED' ||
    lead.currentStage === 'DO_NOT_CONTACT'
  );
}
