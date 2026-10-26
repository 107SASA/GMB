import mongoose, { Schema, Document } from 'mongoose';

/**
 * One message on the GrowwMatics platform WhatsApp line, in or out — what the
 * Super Admin WhatsApp Inbox shows (services/inbox/whatsappLog.ts). Inbound
 * is written by the webhook before any agent routing, outbound by the
 * MessageQueue send log, so every chat is here whichever agent (or none)
 * handled it.
 *
 * Not recorded: review requests a customer's workspace sends to its own
 * customers (they go out on this line but are not our conversations). A
 * reply from one of those people IS recorded, flagged `reviewReply`.
 */
export interface IWhatsAppMessage extends Document {
  threadId: mongoose.Types.ObjectId;
  phone: string;               // E.164 with '+'
  phoneKey: string;            // last 10 digits
  direction: 'in' | 'out';
  text: string;
  /** in: the person. out: 'team' (sent from the Inbox), 'bot' (an agent or automated message). */
  sender: 'customer' | 'team' | 'bot';
  /** Team member who sent it from the Inbox. */
  sentByUserId?: mongoose.Types.ObjectId;
  /** The Inbox's id for a reply, so a double click or retry is sent once. */
  clientKey?: string;
  /** Approved template name, when it went out as one. */
  template?: string;
  /** MessageQueue row of an outbound message — its delivery status. */
  queueId?: mongoose.Types.ObjectId;
  /** Provider message id of an inbound message (de-duplication). */
  providerMessageId?: string;
  mediaCount?: number;
  /** Inbound from someone a customer's workspace recently asked for a review. */
  reviewReply?: boolean;
  leadId?: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  businessId?: mongoose.Types.ObjectId;
  at: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppMessageSchema: Schema = new Schema(
  {
    threadId: { type: Schema.Types.ObjectId, ref: 'WhatsAppThread', required: true },
    phone: { type: String, required: true },
    phoneKey: { type: String, required: true },
    direction: { type: String, enum: ['in', 'out'], required: true },
    text: { type: String, default: '' },
    sender: { type: String, enum: ['customer', 'team', 'bot'], required: true },
    sentByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    clientKey: { type: String },
    template: { type: String },
    queueId: { type: Schema.Types.ObjectId, ref: 'MessageQueue' },
    providerMessageId: { type: String },
    mediaCount: { type: Number },
    reviewReply: { type: Boolean },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

WhatsAppMessageSchema.index({ threadId: 1, at: 1 });
WhatsAppMessageSchema.index({ phoneKey: 1, at: -1 });
WhatsAppMessageSchema.index({ threadId: 1, clientKey: 1 }, { partialFilterExpression: { clientKey: { $type: 'string' } } });
WhatsAppMessageSchema.index({ providerMessageId: 1 }, { unique: true, partialFilterExpression: { providerMessageId: { $type: 'string' } } });
WhatsAppMessageSchema.index({ queueId: 1 }, { unique: true, partialFilterExpression: { queueId: { $type: 'objectId' } } });

export default mongoose.models.WhatsAppMessage || mongoose.model<IWhatsAppMessage>('WhatsAppMessage', WhatsAppMessageSchema);
