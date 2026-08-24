import mongoose, { Schema, Document } from 'mongoose';

export interface ISupportMessage {
  role: 'agent' | 'lead';
  text: string;
  at: Date;
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
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business' },
  },
  { timestamps: true }
);

SupportConversationSchema.index({ phoneKey: 1, status: 1 });

export default mongoose.models.SupportConversation ||
  mongoose.model<ISupportConversation>('SupportConversation', SupportConversationSchema);
