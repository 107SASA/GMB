import mongoose, { Schema, Document } from 'mongoose';
import { applyConversationMessageCap } from './shared/conversationMessageCap';

export interface ISupportMessage {
  role: 'agent' | 'lead';
  text: string;
  at: Date;
  /** 'whatsapp' when the line came from the WhatsApp webhook (opens the 24h reply window). */
  via?: string;
}

/**
 * A support inquiry on the GrowwMatics platform WhatsApp line — separate
 * from SalesConversation/BookingConversation/ReportConversation (those are
 * prospect-facing; this is for existing customers asking for product help).
 * One-shot acknowledgment + human handoff, not a multi-turn data-collection
 * flow — no `details` sub-doc like BookingConversation has. A human can
 * already reply directly via the WhatsApp Business app/Twilio/Meta Business
 * Suite regardless of what the bot said; this model exists so the team has
 * somewhere to see and track these instead of relying solely on watching
 * the WhatsApp inbox.
 */
export interface ISupportConversation extends Document {
  leadPhone: string;          // E.164 with '+'
  phoneKey: string;           // last-10-digits key for robust matching
  leadName: string;
  status: 'active' | 'closed';
  messages: ISupportMessage[];
  // Set when the inbound phone matched an existing, verified GrowwMatics
  // User — lets composeAgentReply personalize the reply and lets the team
  // jump straight to the right account instead of just a phone number.
  userId?: mongoose.Types.ObjectId;
  businessId?: mongoose.Types.ObjectId;
  // Phase 8 — platform-side equivalent of ConversationThread.aiEnabled on
  // the tenant side (there is no ConversationThread for platform leads, so
  // this lives directly on SupportConversation instead). Only meaningful
  // once the associated Lead is currentAgent==='IN_HOUSE' (a paying
  // customer getting real multi-turn AI support) — false skips the LLM
  // call entirely and notifies a human instead, same as the tenant
  // pattern. Defaults true so existing pre-Phase-8 conversations behave
  // exactly as before (AI-enabled) once this field starts being read.
  aiEnabled: boolean;
  // Segment 4A (Oct 2026) — minimal support intake (services/support/supportIntake.ts).
  /** How the sender was recognised: a verified user, a paying/trial workspace by phone, a support request, or a sales thread handed over. */
  matchedBy?: 'verified_user' | 'paying_customer' | 'support_request' | 'sales_handoff';
  /** false when userId/businessId come from an unverified phone match — staff must confirm identity before discussing the account. */
  senderVerified?: boolean;
  /** The one automatic acknowledgement for this issue (claimed atomically before sending). */
  ackSentAt?: Date;
  closedAt?: Date;
  closedReason?: 'idle' | 'opt_out' | 'resolved';
  createdAt: Date;
  updatedAt: Date;
}

const SupportConversationSchema: Schema = new Schema(
  {
    leadPhone: { type: String, required: true, index: true },
    phoneKey: { type: String, index: true },
    leadName: { type: String, default: '' },
    status: { type: String, enum: ['active', 'closed'], default: 'active', index: true },
    messages: {
      type: [
        new Schema(
          {
            role: { type: String, enum: ['agent', 'lead'], required: true },
            text: { type: String, required: true },
            at: { type: Date, default: Date.now },
            via: { type: String },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business' },
    aiEnabled: { type: Boolean, default: true },
    matchedBy: { type: String, enum: ['verified_user', 'paying_customer', 'support_request', 'sales_handoff'] },
    senderVerified: { type: Boolean },
    ackSentAt: { type: Date },
    closedAt: { type: Date },
    closedReason: { type: String, enum: ['idle', 'opt_out', 'resolved'] },
  },
  { timestamps: true }
);

SupportConversationSchema.index({ phoneKey: 1, status: 1 });

applyConversationMessageCap(SupportConversationSchema);

export default mongoose.models.SupportConversation ||
  mongoose.model<ISupportConversation>('SupportConversation', SupportConversationSchema);
