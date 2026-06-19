import mongoose, { Schema, Document } from 'mongoose';

export interface IMessageQueue extends Document {
  leadId?: mongoose.Types.ObjectId;
  direction: 'INBOUND' | 'OUTBOUND';
  status: 'PENDING' | 'SENT' | 'FAILED';
  scheduledAt?: Date;
  sentAt?: Date;
  failedReason?: string;
  payload: any;
  createdAt: Date;
  updatedAt: Date;
}

const MessageQueueSchema: Schema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    direction: { type: String, enum: ['INBOUND', 'OUTBOUND'], required: true },
    status: { 
      type: String, 
      enum: ['PENDING', 'SENT', 'FAILED'], 
      default: 'PENDING',
      index: true
    },
    scheduledAt: { type: Date },
    sentAt: { type: Date },
    failedReason: { type: String },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

export default mongoose.models.MessageQueue || mongoose.model<IMessageQueue>('MessageQueue', MessageQueueSchema);
