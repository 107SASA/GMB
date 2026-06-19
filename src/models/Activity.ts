import mongoose, { Schema, Document } from 'mongoose';

export interface IActivity extends Document {
  tenantId: string;
  organizationId?: string;
  leadId: mongoose.Types.ObjectId;
  
  type: 'call' | 'WhatsApp' | 'email' | 'note' | 'meeting' | 'status_change';
  content: string;
  metadata?: any;
  
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ActivitySchema: Schema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    organizationId: { type: String, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    
    type: { 
      type: String, 
      enum: ['call', 'WhatsApp', 'email', 'note', 'meeting', 'status_change'],
      required: true
    },
    content: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.models.Activity || mongoose.model<IActivity>('Activity', ActivitySchema);
