import mongoose, { Schema, Document } from 'mongoose';

/**
 * Super-admin follow-up calls to customers who've gone quiet ("Needs a call"
 * list in /admin/customers). One row per call/attempt, so the team can see
 * who was already called, what they said, and when to call again.
 */
export const CALL_OUTCOMES = ['reached', 'no_answer', 'call_back', 'not_interested', 'whatsapp_sent'] as const;
export type CallOutcome = typeof CALL_OUTCOMES[number];

export interface ICustomerCallLog extends Document {
  userId: mongoose.Types.ObjectId;
  businessId?: mongoose.Types.ObjectId;
  adminUserId: mongoose.Types.ObjectId;
  adminName?: string;
  outcome: CallOutcome;
  note?: string;
  followUpAt?: Date;
  createdAt: Date;
}

const CustomerCallLogSchema = new Schema<ICustomerCallLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business' },
    adminUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    adminName: { type: String },
    outcome: { type: String, enum: CALL_OUTCOMES, required: true },
    note: { type: String, maxlength: 2000 },
    followUpAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

CustomerCallLogSchema.index({ userId: 1, createdAt: -1 });

export default (mongoose.models.CustomerCallLog as mongoose.Model<ICustomerCallLog>) ||
  mongoose.model<ICustomerCallLog>('CustomerCallLog', CustomerCallLogSchema);
