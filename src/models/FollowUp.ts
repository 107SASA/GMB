import mongoose, { Schema, Document } from 'mongoose';

export interface IFollowUp extends Document {
  tenantId: string;
  organizationId?: string;
  leadId: mongoose.Types.ObjectId;
  
  scheduledFor: Date;
  status: 'pending' | 'completed' | 'skipped' | 'failed';
  messageTemplate?: string;
  
  completedAt?: Date;
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
      enum: ['pending', 'completed', 'skipped', 'failed'],
      default: 'pending',
      index: true
    },
    messageTemplate: { type: String },
    
    completedAt: { type: Date }
  },
  { timestamps: true }
);

export default mongoose.models.FollowUp || mongoose.model<IFollowUp>('FollowUp', FollowUpSchema);
