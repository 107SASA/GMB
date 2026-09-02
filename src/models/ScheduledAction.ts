import mongoose, { Schema, Document } from 'mongoose';

/**
 * A durable, pollable outbound-message intent — created instead of sending
 * inline when LEAD_ENGINE_V2 is on for a lead (see
 * services/orchestration/outboundOrchestrator.ts and the gated branch of
 * runSalesFollowUpDrip in services/inngest/functions.ts). Picked up by the
 * nurtureSchedulerTick cron, which re-validates everything fresh at fire
 * time (ownership, stage, opt-out, cooldown) rather than trusting whatever
 * was true when this row was created — a lead's state can change in the
 * gap between scheduling and firing (demo booked, opted out, handed to a
 * human, etc), and this row must never cause a stale send.
 *
 * idempotencyKey has a unique index so the same logical action (same lead,
 * same action type, same due-time bucket) can never be double-scheduled —
 * mirrors the same insert-as-atomicity-guarantee pattern already used by
 * ProcessedWebhookEvent for webhook dedup.
 */
export type ScheduledActionStatus = 'PENDING' | 'EXECUTED' | 'SKIPPED' | 'CANCELLED';

export interface IScheduledAction extends Document {
  leadId: mongoose.Types.ObjectId;
  actionType:
    | 'ASK_QUALIFICATION' | 'EDUCATE' | 'SHARE_USE_CASE' | 'ANSWER_QUESTION'
    | 'HANDLE_OBJECTION' | 'SHOW_VALUE' | 'OFFER_DEMO' | 'SCHEDULE_DEMO'
    | 'SEND_PRICING' | 'FOLLOW_UP_AFTER_DEMO' | 'OFFER_SUBSCRIPTION'
    | 'REENGAGE' | 'WAIT' | 'HUMAN_HANDOFF' | 'STOP'
    // Phase 6 additions — beyond the pure-NBA-action list (same category of
    // extension as `payload` above). DEMO_REMINDER is still a real WhatsApp
    // send (goes through requestOutboundMessage like every other actionType
    // — see nurtureSchedulerTick's buildMessageForAction). NO_SHOW_CHECK is
    // NOT a send at all — nurtureSchedulerTick special-cases it to run a
    // status check instead of calling the orchestrator; see that function's
    // own doc comment for why this one actionType breaks the "every row
    // sends a message" pattern the rest of this model follows.
    | 'DEMO_REMINDER' | 'NO_SHOW_CHECK';
  dueAt: Date;
  status: ScheduledActionStatus;
  reason?: string;
  idempotencyKey: string;
  createdBy: string;
  // Atomic-claim marker for nurtureSchedulerTick. Set (to `now`) by an atomic
  // findOneAndUpdate the instant a tick takes ownership of a PENDING row, so
  // two overlapping ticks can't both process the same row. Cleared implicitly
  // when the row leaves PENDING. A row still PENDING with an old claimedAt was
  // claimed by a tick that then crashed before recording an outcome — it
  // becomes eligible again after CLAIM_STALE_MS (see functions.ts).
  claimedAt?: Date | null;
  // Not in the task's literal field list — added because nurtureSchedulerTick
  // needs enough context to actually compose the right message at fire
  // time, not just know an actionType is due. For the sales-drip use case
  // this carries { conversationId, followUpIndex } so the tick can call the
  // exact same composeFollowUp(SalesAgentConfig.followUps[followUpIndex])
  // the legacy inline path would have used — same shape/spirit as
  // LeadEvent.payload and MessageQueue.payload elsewhere in this codebase.
  payload?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const ScheduledActionSchema: Schema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    actionType: {
      type: String,
      enum: [
        'ASK_QUALIFICATION', 'EDUCATE', 'SHARE_USE_CASE', 'ANSWER_QUESTION',
        'HANDLE_OBJECTION', 'SHOW_VALUE', 'OFFER_DEMO', 'SCHEDULE_DEMO',
        'SEND_PRICING', 'FOLLOW_UP_AFTER_DEMO', 'OFFER_SUBSCRIPTION',
        'REENGAGE', 'WAIT', 'HUMAN_HANDOFF', 'STOP',
        'DEMO_REMINDER', 'NO_SHOW_CHECK',
      ],
      required: true,
    },
    dueAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ['PENDING', 'EXECUTED', 'SKIPPED', 'CANCELLED'], default: 'PENDING', index: true },
    reason: { type: String },
    idempotencyKey: { type: String, required: true, unique: true },
    createdBy: { type: String, required: true, default: 'system' },
    claimedAt: { type: Date, default: null },
    payload: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Primary access pattern for nurtureSchedulerTick: "every PENDING row due by
// now, not currently claimed" — status + dueAt narrow it; claimedAt is
// filtered in-query ($or null / stale) but is low-cardinality so it's not
// worth its own index key here.
ScheduledActionSchema.index({ status: 1, dueAt: 1 });

export default mongoose.models.ScheduledAction ||
  mongoose.model<IScheduledAction>('ScheduledAction', ScheduledActionSchema);
