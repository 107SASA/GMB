import mongoose, { Schema, Document } from 'mongoose';

export interface IMessageQueue extends Document {
  leadId?: mongoose.Types.ObjectId;
  direction: 'INBOUND' | 'OUTBOUND';
  status: 'PENDING' | 'SENT' | 'FAILED';
  scheduledAt?: Date;
  sentAt?: Date;
  failedReason?: string;
  errorCode?: string;
  /** lib/whatsappDiagnostics.ts kind — why a send failed, distinguishable. */
  errorKind?: string;
  /** Evidence from Twilio's delivery callback (status SENT only means "accepted"). */
  deliveredAt?: Date;
  readAt?: Date;
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
    errorCode: { type: String },
    errorKind: { type: String },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

// Every new outbound send also lands in the Super Admin WhatsApp Inbox
// (services/inbox/whatsappLog.ts decides what is shown). Never throws.
MessageQueueSchema.pre('save', function (this: any) {
  this.$locals.wasNew = this.isNew;
});
MessageQueueSchema.post('save', async function (doc: any) {
  if (!doc.$locals?.wasNew || doc.direction !== 'OUTBOUND') return;
  doc.$locals.wasNew = false;
  try {
    const { recordOutboundFromQueue } = await import('@/services/inbox/whatsappLog');
    await recordOutboundFromQueue(doc);
  } catch (err: any) {
    console.warn('[MessageQueue] inbox record failed:', err?.message);
  }
});

export default mongoose.models.MessageQueue || mongoose.model<IMessageQueue>('MessageQueue', MessageQueueSchema);
