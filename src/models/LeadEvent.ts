import mongoose, { Schema, Document } from 'mongoose';

/**
 * Append-only timeline of lead-related state changes, across every WhatsApp
 * agent (sales/booking/support/report) and the tenant inbound pipeline.
 * Additive/observational only — nothing reads this yet to make decisions;
 * it exists so the full history of a lead's journey is queryable later
 * without re-deriving it from scattered conversation documents.
 *
 * Written via services/leadEvents.ts's logLeadEvent(), which never throws —
 * same "never fail the workflow" contract as services/push.ts. A logging
 * failure must never break message delivery.
 *
 * leadId is OPTIONAL and deliberately not backfilled by a special lookup:
 * SalesConversation and SupportConversation have no leadId field at all
 * (Sales is keyed by businessId+phone, Support by userId+phone) — only
 * BookingConversation carries one, and only once a booking is actually
 * filed. Rather than adding new Lead.findOne/create calls at logging call
 * sites (a behavior change this phase must not make), every event also
 * carries `phone` plus the originating conversation's type/id, so the full
 * timeline for a phone number is always queryable even before a Lead
 * exists, and leadId is filled in whenever the caller already has one on
 * hand — never fetched specially for this.
 */
export type LeadEventType =
  | 'LEAD_CREATED'
  | 'MESSAGE_RECEIVED'
  | 'MESSAGE_SENT'
  | 'AGENT_HANDOFF'
  | 'INTENT_CHANGED'
  | 'LEAD_SCORE_CHANGED'
  | 'OBJECTION_DETECTED'
  | 'DEMO_REQUESTED'
  | 'DEMO_SCHEDULED'
  | 'DEMO_RESCHEDULED'
  | 'DEMO_CANCELLED'
  | 'DEMO_COMPLETED'
  | 'DEMO_NO_SHOW'
  | 'NURTURE_ACTION_SCHEDULED'
  | 'NURTURE_ACTION_CANCELLED'
  | 'NURTURE_ACTION_SKIPPED'
  | 'PAYMENT_SUCCESS'
  | 'CUSTOMER_ACTIVATED'
  | 'HUMAN_HANDOFF'
  | 'OPT_OUT'
  | 'NBA_OVERRIDDEN';

const LEAD_EVENT_TYPES: LeadEventType[] = [
  'LEAD_CREATED',
  'MESSAGE_RECEIVED',
  'MESSAGE_SENT',
  'AGENT_HANDOFF',
  'INTENT_CHANGED',
  'LEAD_SCORE_CHANGED',
  'OBJECTION_DETECTED',
  'DEMO_REQUESTED',
  'DEMO_SCHEDULED',
  'DEMO_RESCHEDULED',
  'DEMO_CANCELLED',
  'DEMO_COMPLETED',
  'DEMO_NO_SHOW',
  'NURTURE_ACTION_SCHEDULED',
  'NURTURE_ACTION_CANCELLED',
  'NURTURE_ACTION_SKIPPED',
  'PAYMENT_SUCCESS',
  'CUSTOMER_ACTIVATED',
  'HUMAN_HANDOFF',
  'OPT_OUT',
  'NBA_OVERRIDDEN',
];

// Which platform/tenant conversation collection produced this event, if any
// — lets a later reader join back to the source document without guessing.
export type LeadEventConversationType = 'sales' | 'booking' | 'support' | 'report' | 'tenant' | null;

export interface ILeadEvent extends Document {
  // Optional on purpose — see file-level comment. Present whenever the call
  // site already has a real Lead._id in hand (tenant inbound, a filed
  // DemoBooking, etc); absent for phone-keyed platform conversations that
  // have no Lead yet (e.g. most Sales/Support agent turns).
  leadId?: mongoose.Types.ObjectId;
  // Always present when available to the caller — the one identifier every
  // WhatsApp event has regardless of which conversation collection it came
  // from, so the timeline for a phone number is queryable even pre-Lead.
  phone?: string;
  conversationType?: LeadEventConversationType;
  conversationId?: mongoose.Types.ObjectId;
  type: LeadEventType;
  // Small, structured context for this event — e.g. { channel: 'whatsapp',
  // agent: 'sales-agent' } or { from: 'active', to: 'handed_off' }. Never put
  // raw secrets/tokens/full message bodies with PII beyond what's already
  // stored elsewhere here — this is a lightweight timeline, not message
  // storage.
  payload?: Record<string, unknown>;
  // Who/what caused this event — e.g. "sales-agent", "booking-agent",
  // "support-agent", "report-agent", "system", or a human User's id string.
  actor: string;
  createdAt: Date;
}

const LeadEventSchema: Schema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    phone: { type: String, index: true },
    conversationType: { type: String, enum: ['sales', 'booking', 'support', 'report', 'tenant', null], default: null },
    conversationId: { type: Schema.Types.ObjectId },
    type: { type: String, enum: LEAD_EVENT_TYPES, required: true },
    payload: { type: Schema.Types.Mixed },
    actor: { type: String, required: true, default: 'system' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Primary access pattern: "recent timeline for this lead" — powers both the
// manual verification query below and any future per-lead timeline view.
LeadEventSchema.index({ leadId: 1, createdAt: -1 });
// Secondary access pattern: "recent timeline for this phone number" — needed
// because most platform-agent events have no leadId yet (see comment above).
LeadEventSchema.index({ phone: 1, createdAt: -1 });

export default mongoose.models.LeadEvent || mongoose.model<ILeadEvent>('LeadEvent', LeadEventSchema);
