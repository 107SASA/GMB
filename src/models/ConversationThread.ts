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
    lastActivityAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

export default mongoose.models.ConversationThread || mongoose.model<IConversationThread>('ConversationThread', ConversationThreadSchema);
