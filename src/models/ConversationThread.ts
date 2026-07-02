import mongoose, { Schema, Document } from 'mongoose';

export interface IConversationThread extends Document {
  tenantId: string;
  businessId: mongoose.Types.ObjectId;
  leadId: mongoose.Types.ObjectId;
  unreadCount: number;
  lastMessage: string;
  aiEnabled: boolean;
  assignedAgent?: mongoose.Types.ObjectId;
  lastActivityAt: Date;
  // ADDITIVE — holds a single in-flight WhatsApp AI Agent action
  // (booking/cancellation/reschedule) awaiting the customer's yes/no
  // confirmation or missing details. Cleared once resolved. Never read
  // or written by any non-WhatsApp code path.
  pendingAction?: {
    type: 'book_appointment' | 'cancel_appointment' | 'reschedule_appointment';
    payload: any;
    createdAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationThreadSchema: Schema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    unreadCount: { type: Number, default: 0 },
    lastMessage: { type: String },
    aiEnabled: { type: Boolean, default: true },
    assignedAgent: { type: Schema.Types.ObjectId, ref: 'User' },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    // Stored as Mixed (not a strict sub-schema) to avoid clashing with
    // Mongoose's reserved `type` key when nesting a field literally named
    // "type". Shape enforced in application code (see whatsapp-agent services).
    pendingAction: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.ConversationThread || mongoose.model<IConversationThread>('ConversationThread', ConversationThreadSchema);
