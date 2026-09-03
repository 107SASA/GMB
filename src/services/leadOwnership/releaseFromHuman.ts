import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { setLeadOwnership, type LeadAgent, type LeadStage } from '@/services/leadOwnership/setLeadOwnership';

/**
 * P0 fix (post-implementation-audit, "Return to AI" re-trigger bug).
 *
 * Releasing a HUMAN-owned lead back to an agent used to be a bare
 * setLeadOwnership() call — which correctly changes currentAgent/
 * currentStage but does nothing about the TRANSIENT trigger-detector state
 * that caused the original handoff. Two of the three handoff reasons left
 * that state fully intact, so the very next inbound message could
 * re-trigger the identical handoff with zero new evidence:
 *
 *   - 'explicit-request': stateless (a regex match on the CURRENT message
 *     only) — nothing to reset. Left untouched on purpose.
 *   - 'low-confidence-streak': Lead.recentExtractionConfidences is a bare
 *     2-entry rolling window with no purpose anywhere else in the
 *     codebase (confirmed) — pure transient detector scratch state, not
 *     lead-intelligence history. Cleared to [] on every release.
 *   - 'stuck-hot-lead': the trigger is `leadScore >= threshold &&
 *     currentStage === 'NURTURING' && followUpsSent >= cyclesThreshold`.
 *     leadScore and SalesConversation.followUpsSent are REAL lead history
 *     (this fix deliberately does NOT touch either — see the file-level
 *     comment on Lead.followUpsSentAtRelease for why) — but resuming a
 *     Sales-released lead directly into 'NURTURING' (which the admin
 *     release flow already did, and still does) trivially satisfies the
 *     stage half of that condition immediately. Instead of erasing
 *     history, this snapshots the CURRENT followUpsSent count as a
 *     baseline the trigger must exceed — so it only re-fires once at
 *     least one NEW follow-up cycle has actually happened after release,
 *     not from the same stale count that caused the original handoff.
 *
 * This function does NOT decide what agent/stage to release to — the
 * caller (the admin "Return to AI" route) still owns that decision; this
 * only wraps setLeadOwnership with the handoff-state cleanup that must
 * happen alongside it, and clears humanHandoff.active (which
 * setLeadOwnership itself deliberately does not touch — see its own doc
 * comment on the HUMAN case in syncLegacyStatus).
 */
export async function releaseFromHuman(
  leadId: string | mongoose.Types.ObjectId,
  targetAgent: LeadAgent,
  reason: string,
  actor: string,
  resumeStage?: LeadStage
): Promise<void> {
  await dbConnect();

  const lead = await Lead.findById(leadId);
  if (!lead) return;

  const handoffReason = lead.humanHandoff?.reason;

  // Clear humanHandoff.active regardless of reason — setLeadOwnership does
  // not touch this field (there is no legacy status to sync it against),
  // so this is the only place it gets cleared.
  lead.humanHandoff = { ...(lead.humanHandoff || { active: false }), active: false };

  if (handoffReason === 'low-confidence-streak') {
    lead.recentExtractionConfidences = [];
  }

  if (handoffReason === 'stuck-hot-lead') {
    try {
      const { default: SalesConversation } = await import('@/models/SalesConversation');
      const { phoneDedupeKey } = await import('@/lib/phone');
      const key = phoneDedupeKey(lead.phone);
      const convo = key
        ? (await SalesConversation.findOne({ phoneKey: key }).select('followUpsSent').lean() as any)
        : null;
      // Snapshot, not a reset — SalesConversation.followUpsSent itself is
      // never modified here, only read to record where it stood at release
      // time. If no SalesConversation is found, default to 0 so the
      // trigger's ">= cyclesThreshold" check on the DELTA still requires
      // at least `cyclesThreshold` fresh follow-ups from a clean baseline.
      lead.followUpsSentAtRelease = convo?.followUpsSent ?? 0;
    } catch (err: any) {
      console.warn('[releaseFromHuman] failed to snapshot followUpsSent:', err?.message);
    }
  }

  await lead.save();

  // setLeadOwnership handles the actual currentAgent/currentStage write,
  // legacy-collection sync, pending-ScheduledAction cancellation, and the
  // AGENT_HANDOFF LeadEvent — none of which this function duplicates.
  await setLeadOwnership(lead._id, targetAgent, reason, actor, resumeStage);
}
