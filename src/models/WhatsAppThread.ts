import mongoose, { Schema, Document } from 'mongoose';

/**
 * One chat per phone number on the GrowwMatics platform WhatsApp line — a row
 * in the Super Admin WhatsApp Inbox. Kept up to date by
 * services/inbox/whatsappLog.ts as messages arrive and go out; the messages
 * themselves are WhatsAppMessage rows.
 */
export interface IWhatsAppThread extends Document {
  phone: string;               // E.164 with '+'
  phoneKey: string;            // last 10 digits — one thread per number
  name: string;                // WhatsApp profile name, until a lead name is known
  lastMessageAt: Date;
  lastMessageText: string;
  lastDirection: 'in' | 'out';
  /** Last message the person sent — the 24h reply window and "unread". */
  lastInboundAt?: Date;
  /** When a team member last opened the chat in the Inbox. */
  lastReadAt?: Date;
  /** 'resolved' once the team marks it handled; a new inbound message reopens it. */
  status: 'open' | 'resolved';
  resolvedAt?: Date;
  /** Someone a customer's workspace asked for a review has written to us. */
  reviewReply?: boolean;
  leadId?: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  businessId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppThreadSchema: Schema = new Schema(
  {
    phone: { type: String, required: true },
    phoneKey: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    lastMessageAt: { type: Date, required: true },
    lastMessageText: { type: String, default: '' },
    lastDirection: { type: String, enum: ['in', 'out'], default: 'out' },
    lastInboundAt: { type: Date },
    lastReadAt: { type: Date },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    resolvedAt: { type: Date },
    reviewReply: { type: Boolean },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
  },
  { timestamps: true }
);

WhatsAppThreadSchema.index({ lastMessageAt: -1 });

export default mongoose.models.WhatsAppThread || mongoose.model<IWhatsAppThread>('WhatsAppThread', WhatsAppThreadSchema);
