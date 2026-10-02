import mongoose, { Schema, Document } from 'mongoose';

export interface IFollowUp extends Document {
  tenantId: string;
  organizationId?: string;
  leadId: mongoose.Types.ObjectId;

  scheduledFor: Date;
  status: 'pending' | 'completed' | 'skipped' | 'failed' | 'cancelled';
  /** LEGACY: text of an automatic WhatsApp the old Day 1/3/7 chain sent (removed Oct 2026). */
  messageTemplate?: string;

  completedAt?: Date;

  /**
   * Customer CRM follow-up = a TASK/REMINDER for the owner or a team member
   * (never an automatic message to the lead). Legacy rows have no businessId.
   */
  businessId?: mongoose.Types.ObjectId;
  kind?: 'task' | 'legacy_auto_message';
  type?: 'Call' | 'WhatsApp' | 'Email' | 'Meeting' | 'Other';
  note?: string;
  assignedUserId?: mongoose.Types.ObjectId;
  createdBy?: mongoose.Types.ObjectId;
  reminderSentAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const FollowUpSchema: Schema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    organizationId: { type: String, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },

    scheduledFor: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'completed', 'skipped', 'failed', 'cancelled'],
      default: 'pending',
      index: true
    },
    messageTemplate: { type: String },

    completedAt: { type: Date },

    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    kind: { type: String, enum: ['task', 'legacy_auto_message'] },
    type: { type: String, enum: ['Call', 'WhatsApp', 'Email', 'Meeting', 'Other'] },
    note: { type: String, maxlength: 1000 },
    assignedUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reminderSentAt: { type: Date },
  },
  { timestamps: true }
);

// Due-reminder sweep + per-workspace task lists.
FollowUpSchema.index({ businessId: 1, status: 1, scheduledFor: 1 });

export default mongoose.models.FollowUp || mongoose.model<IFollowUp>('FollowUp', FollowUpSchema);
