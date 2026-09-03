import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead, { type ILead } from '@/models/Lead';
import { logLeadEvent } from '@/services/leadEvents';
import { phoneDedupeKey } from '@/lib/phone';
import { cancelScheduledActions } from '@/services/scheduler/cancelScheduledActions';

export type LeadAgent = 'NONE' | 'SALES' | 'DEMO' | 'IN_HOUSE' | 'HUMAN';
export type LeadStage =
  | 'NEW' | 'QUALIFYING' | 'NURTURING' | 'DEMO_REQUESTED' | 'DEMO_SCHEDULED'
  | 'DEMO_COMPLETED' | 'CONVERSION_PENDING' | 'PAYMENT_VERIFIED' | 'CUSTOMER'
  | 'COLD' | 'UNRESPONSIVE' | 'LONG_TERM_NURTURE' | 'LOST' | 'DO_NOT_CONTACT'
  | 'HUMAN_HANDOFF';

export interface SetLeadOwnershipResult {
  leadId: string;
  from: LeadAgent;
  to: LeadAgent;
  changed: boolean;
  stageFrom?: LeadStage;
  stageTo?: LeadStage;
  stageChanged?: boolean;
}

/**
 * Single write-path for Lead.currentAgent AND (optionally) Lead.currentStage
 * (the ownership/stage engine being introduced alongside the existing
 * per-collection status enums — SalesConversation.status,
 * BookingConversation.status, etc). Shadow mode: nothing reads
 * Lead.currentAgent/currentStage to make a routing/reply decision on its
 * own yet outside the Phase 5 orchestrator (which is itself gated behind
 * LEAD_ENGINE_V2 + cohort) — see the file-level comment on those fields and
 * the call site in app/api/whatsapp/webhook/route.ts. A FUTURE phase that
 * reads these fields to decide who replies to a lead MUST check
 * process.env.LEAD_ENGINE_V2 === 'true' first; this function itself runs
 * unconditionally because it is purely observational data collection, not a
 * decision.
 *
 * `newStage` is optional — pass it whenever the caller also knows the
 * lead's new stage (e.g. a demo being booked moves both currentAgent to
 * DEMO and currentStage to DEMO_REQUESTED in one call). Kept as one function
 * rather than two separate setters so BOTH fields always go through a
 * single, auditable write-path — no code anywhere else in this codebase
 * writes Lead.currentStage.
 *
 * No-ops each field's write (but still logs) if it already equals the
 * requested value — avoids a no-op AGENT_HANDOFF flooding LeadEvent every
 * time this is called with an unchanged value.
 *
 * Also syncs the matching legacy collection's status so the old and new
 * systems can't contradict each other during the migration — e.g. moving to
 * DEMO marks any active SalesConversation for this lead's phone as
 * 'handed_off'. Moving to HUMAN deliberately does NOT touch any legacy
 * status field (there's no legacy "human owns this" status to sync to); it
 * only sets Lead.humanHandoff, which is the field a later orchestration
 * phase will check.
 *
 * Whenever currentAgent OR currentStage actually changes, cancels every
 * still-PENDING ScheduledAction for this lead (services/scheduler/
 * cancelScheduledActions.ts) — an action scheduled under the old
 * ownership/stage is no longer trustworthy the moment either changes, even
 * though nurtureSchedulerTick would also re-validate and skip it at fire
 * time; cancelling outright here is defense-in-depth, not the only
 * safeguard. This also directly covers the task's "DO_NOT_CONTACT or
 * CUSTOMER" requirement, since both are currentStage values passed through
 * this same function.
 *
 * This codebase doesn't use Mongo transactions anywhere today (checked
 * across services/inngest, the webhook route, and the billing webhook), so
 * per the task's own fallback, this is sequential writes with the Lead
 * write first — not a transaction. A crash between the Lead write and the
 * legacy-sync/cancellation writes leaves them briefly inconsistent, same
 * risk profile as every other multi-write flow already in this codebase
 * (e.g. bookingAgentReply's Lead + DemoBooking + Activity sequence).
 */
export async function setLeadOwnership(
  leadId: string | mongoose.Types.ObjectId,
  newAgent: LeadAgent,
  reason: string,
  actor: string = 'system',
  newStage?: LeadStage
): Promise<SetLeadOwnershipResult | null> {
  await dbConnect();

  const lead = await Lead.findById(leadId);
  if (!lead) {
    console.warn('[setLeadOwnership] Lead not found:', String(leadId));
    return null;
  }

  const from = (lead.currentAgent || 'NONE') as LeadAgent;
  const changed = from !== newAgent;
  const stageFrom = lead.currentStage as LeadStage | undefined;
  const stageChanged = newStage !== undefined && stageFrom !== newStage;

  if (changed) {
    // Lead write first (per the task's transaction fallback ordering).
    lead.currentAgent = newAgent;
  }
  if (stageChanged) {
    lead.currentStage = newStage;
  }
  if (changed || stageChanged) {
    await lead.save();
  }

  if (changed) {
    // Legacy sync — best-effort, never blocks or fails the ownership write
    // itself. Keyed by phone since none of the legacy collections reference
    // Lead._id directly (see LeadEvent.ts's file-level comment for the same
    // observation from Phase 1).
    try {
      await syncLegacyStatus(lead, newAgent);
    } catch (err: any) {
      console.warn('[setLeadOwnership] legacy sync failed:', err?.message);
    }
  }

  if (changed || stageChanged) {
    await cancelScheduledActions(
      lead._id,
      changed && stageChanged
        ? 'agent-and-stage-changed'
        : changed
          ? 'agent-changed'
          : 'stage-changed'
    );
  }

  // Logged either way (no-op or real change) per the task spec — gives a
  // complete audit trail of every ownership check, not just the changes.
  logLeadEvent(
    'AGENT_HANDOFF',
    { from, to: newAgent, reason, noop: !changed, stageFrom, stageTo: newStage, stageNoop: newStage !== undefined && !stageChanged },
    actor,
    { leadId: lead._id, phone: lead.phone }
  );

  return { leadId: String(lead._id), from, to: newAgent, changed, stageFrom, stageTo: newStage, stageChanged };
}

/**
 * Marks the legacy collection that corresponds to the new owner as the
 * active one, and stands down whichever legacy collection the lead is
 * moving away from — so the old per-collection status fields and the new
 * Lead.currentAgent field never disagree about who currently owns the lead
 * while both systems exist side by side.
 */
async function syncLegacyStatus(lead: ILead, newAgent: LeadAgent): Promise<void> {
  const key = phoneDedupeKey(lead.phone);
  if (!key) return; // no phone to match legacy collections by

  const { default: SalesConversation } = await import('@/models/SalesConversation');
  const { default: BookingConversation } = await import('@/models/BookingConversation');
  const { default: ReportConversation } = await import('@/models/ReportConversation');

  switch (newAgent) {
    case 'DEMO':
      // Moving to the demo/booking agent stands down an active sales thread,
      // same transition handleActiveSalesConversation already performs today
      // on a booking-keyword match — this just keeps Lead.currentAgent from
      // disagreeing with it when the move happens some other way.
      await SalesConversation.updateMany(
        { phoneKey: key, status: 'active' },
        { $set: { status: 'handed_off' } }
      );
      break;
    case 'SALES':
      // Moving back to sales stands down an active (unbooked) demo thread.
      await BookingConversation.updateMany(
        { phoneKey: key, status: 'active' },
        { $set: { status: 'stopped' } }
      );
      break;
    case 'IN_HOUSE':
      // In-house/customer support owns the lead now — stand down any active
      // prospect-facing threads (report is the only one with no "this lead
      // converted" terminal status, so it's stopped explicitly here too).
      await SalesConversation.updateMany(
        { phoneKey: key, status: 'active' },
        { $set: { status: 'completed' } }
      );
      await BookingConversation.updateMany(
        { phoneKey: key, status: 'active' },
        { $set: { status: 'stopped' } }
      );
      await ReportConversation.updateMany(
        { phoneKey: key, status: { $in: ['awaiting_connection', 'connected'] } },
        { $set: { status: 'stopped' } }
      );
      break;
    case 'HUMAN':
      // Deliberately no legacy sync — there is no legacy "a human owns this"
      // status on any of the four collections. Lead.humanHandoff is the only
      // field recording this; a later orchestration phase checks that field
      // directly rather than a legacy status.
      break;
    case 'NONE':
      // Returning to no owner isn't a transition any current flow performs
      // automatically — nothing to stand down.
      break;
    default:
      break;
  }
}
