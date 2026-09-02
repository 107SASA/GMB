import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import OrchestrationConfig from '@/models/OrchestrationConfig';
import { setLeadOwnership } from '@/services/leadOwnership/setLeadOwnership';
import { sendPushToSuperAdmins } from '@/services/push';

/**
 * Same keyword-matching shape as BOOKING_HANDOFF_RE/RESCHEDULE_RE/CANCEL_RE
 * in services/booking/bookingAgent.ts and the platform webhook route's own
 * handoff regexes — deterministic, not an LLM call, so it's instant/free
 * and can't be talked out of by a clever prompt. Matches "agent" only as a
 * standalone word/phrase (task's own wording) so it doesn't fire on
 * unrelated uses of the word (e.g. "insurance agent", "your AI agent is
 * great") — the (?:\b|$) alternation lets it match at the very end of a
 * short message too, not just mid-sentence.
 */
const HUMAN_REQUEST_RE = /\b(talk to a human|speak to (a |)(human|someone|person)|real person|human agent|(can i|i want to|please) speak to (an? )?agent)\b/i;
const STANDALONE_AGENT_RE = /^\s*agent\s*[.!?]?\s*$/i;

export function isExplicitHumanRequest(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  return HUMAN_REQUEST_RE.test(trimmed) || STANDALONE_AGENT_RE.test(trimmed);
}

export type HandoffAgent = 'sales-agent' | 'demo-agent' | 'in-house-agent';

export interface HandoffCheckResult {
  // True whenever the caller must NOT generate/send an AI reply — either
  // because a trigger just fired THIS turn, or because the lead was
  // ALREADY HUMAN-owned before this turn even started (see
  // alreadyHuman below). Every one of the three live agents' reply
  // functions checks this single flag and returns early on true — this is
  // exactly the "confirm a HUMAN-owned lead never gets an AI reply, even
  // on a live/synchronous path that bypasses the Phase 5 orchestrator"
  // guarantee the task asks for; see this file's own top-level comment for
  // why the orchestrator's own ownership check doesn't cover these paths.
  handedOff: boolean;
  reason?: 'explicit-request' | 'low-confidence-streak' | 'stuck-hot-lead';
  /** True when the lead was ALREADY HUMAN-owned before this call — no new handoff happened, but the caller must still skip its AI reply. */
  alreadyHuman?: boolean;
}

/**
 * Shared human-handoff gate, called from all three live agents (Sales,
 * Demo/Booking, In-House) BEFORE generating a reply — see the call sites in
 * services/inngest/functions.ts. Checks the three triggers in the task's
 * order; the first one that matches wins (no need to check the rest once
 * one has already fired). On any match: setLeadOwnership(leadId, 'HUMAN',
 * ..., agentName) + Lead.humanHandoff={active:true, reason, since} +
 * a best-effort push notification to the GrowwMatics team (there is no
 * tenant Business to notify here — see sendPushToSuperAdmins's own doc
 * comment for why this needed a new platform-side equivalent of
 * sendPushToBusinessUsers).
 *
 * Returns { handedOff: true } if any trigger fired — the calling agent
 * MUST stop and not generate/send an AI reply in that case (the caller is
 * responsible for that branch; this function only decides and executes the
 * handoff itself, it doesn't know how to skip a reply for its specific
 * conversation model).
 *
 * Never throws — a failure here must not block the agent's own reply flow
 * (same "never fail the workflow" contract as every other best-effort
 * checker in this codebase). Returns { handedOff: false } on any internal
 * error so the caller proceeds with its normal AI reply rather than being
 * silently blocked by a broken handoff check.
 */
export async function checkHandoffTriggers(
  leadId: string | mongoose.Types.ObjectId,
  latestMessageText: string,
  agentName: HandoffAgent
): Promise<HandoffCheckResult> {
  try {
    await dbConnect();
    const lead = await Lead.findById(leadId);
    if (!lead) return { handedOff: false };

    // Already handed off — nothing to re-check or re-trigger, but the
    // caller must STILL treat this as "don't send an AI reply." Also
    // best-effort re-notifies a human on every subsequent message while
    // human-owned, so a message sent while the team is slow to respond
    // doesn't go unseen (mirrors the tenant-side push-notify-human-inbox
    // behavior, which pages on every inbound message while aiEnabled is
    // false, not just the first).
    if (lead.currentAgent === 'HUMAN') {
      try {
        await sendPushToSuperAdmins({
          title: 'New message for human-owned lead',
          body: `${lead.name || lead.phone} sent a message (was with ${agentName}, currently human-owned).`,
          data: { leadId: String(lead._id) },
        });
      } catch (err: any) {
        console.warn('[checkHandoffTriggers] re-notify push failed:', err?.message);
      }
      return { handedOff: true, alreadyHuman: true };
    }

    // --- Trigger 1: explicit request -----------------------------------------
    if (isExplicitHumanRequest(latestMessageText)) {
      await executeHandoff(lead, 'explicit-request', agentName);
      return { handedOff: true, reason: 'explicit-request' };
    }

    // --- Trigger 2: two consecutive low-confidence extraction turns ---------
    const confidences = lead.recentExtractionConfidences || [];
    if (confidences.length >= 2 && confidences.slice(-2).every((c: number) => c < 0.4)) {
      await executeHandoff(lead, 'low-confidence-streak', agentName);
      return { handedOff: true, reason: 'low-confidence-streak' };
    }

    // --- Trigger 3: high-scoring lead stuck with no stage progression -------
    const config = await OrchestrationConfig.findOne({ key: 'default' })
      .select('stuckLeadScoreThreshold stuckNurtureCyclesThreshold')
      .lean() as any;
    const scoreThreshold = typeof config?.stuckLeadScoreThreshold === 'number' ? config.stuckLeadScoreThreshold : 76;
    const cyclesThreshold = typeof config?.stuckNurtureCyclesThreshold === 'number' ? config.stuckNurtureCyclesThreshold : 3;

    if (typeof lead.leadScore === 'number' && lead.leadScore >= scoreThreshold && lead.currentStage === 'NURTURING') {
      const { default: SalesConversation } = await import('@/models/SalesConversation');
      const { phoneDedupeKey } = await import('@/lib/phone');
      const key = phoneDedupeKey(lead.phone);
      const convo = key
        ? (await SalesConversation.findOne({ phoneKey: key }).select('followUpsSent').lean() as any)
        : null;
      const totalFollowUpsSent = convo?.followUpsSent || 0;
      // P0 fix (post-implementation-audit) — subtract the baseline snapshot
      // taken at the last "Return to AI" release (see
      // services/leadOwnership/releaseFromHuman.ts). Without this, a lead
      // released back to SALES resumes at currentStage:'NURTURING' (which
      // this same trigger requires) with the SAME pre-release followUpsSent
      // count still >= cyclesThreshold, causing an immediate false
      // re-handoff with zero new nurture cycles having actually happened.
      // followUpsSentAtRelease defaults to 0 for a lead that's never been
      // released, so this is a no-op for the normal (never-handed-off) case.
      const followUpsSinceRelease = totalFollowUpsSent - (lead.followUpsSentAtRelease || 0);
      if (convo && followUpsSinceRelease >= cyclesThreshold) {
        await executeHandoff(lead, 'stuck-hot-lead', agentName);
        return { handedOff: true, reason: 'stuck-hot-lead' };
      }
    }

    return { handedOff: false };
  } catch (err: any) {
    console.warn('[checkHandoffTriggers] failed:', err?.message);
    return { handedOff: false };
  }
}

async function executeHandoff(lead: any, reason: HandoffCheckResult['reason'], agentName: HandoffAgent): Promise<void> {
  await setLeadOwnership(lead._id, 'HUMAN', reason || 'handoff', agentName, 'HUMAN_HANDOFF');
  lead.humanHandoff = { active: true, reason, since: new Date() };
  await lead.save();

  try {
    await sendPushToSuperAdmins({
      title: 'Lead needs a human',
      body: `${lead.name || lead.phone} needs a human (${reason}) — was with ${agentName}.`,
      data: { leadId: String(lead._id), reason },
    });
  } catch (err: any) {
    console.warn('[checkHandoffTriggers] push notification failed:', err?.message);
  }
}
