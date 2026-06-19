import mongoose, { Schema, Document } from 'mongoose';

export interface ILead extends Document {
  tenantId: string;
  organizationId?: string;
  businessId?: mongoose.Types.ObjectId;
  assignedUserId?: mongoose.Types.ObjectId;
  
  name: string;
  email?: string;
  phone?: string;
  source: 'WhatsApp' | 'Website' | 'Manual' | 'Instagram' | 'Facebook' | 'Referral' | 'Demo Booking';
  leadType: 'Client Prospect' | 'Platform Prospect';
  status: 'active' | 'inactive';
  pipelineStage: string | null;
  tags: string[];
  notes?: string;
  
  followUpDates: Date[];
  
  aiLeadScore?: number;
  aiInsights?: string;
  qualificationStatus?: string;
  businessType?: string;
  budget?: string;
  urgency?: string;
  interest?: string;
  
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LeadSchema: Schema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    organizationId: { type: String, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    assignedUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    
    name: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    source: { 
      type: String, 
      enum: ['WhatsApp', 'Website', 'Manual', 'Instagram', 'Facebook', 'Referral', 'Demo Booking'],
      default: 'Manual'
    },
    leadType: {
      type: String,
      enum: ['Client Prospect', 'Platform Prospect'],
      default: 'Client Prospect'
    },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    pipelineStage: { type: String, default: null },
    tags: [{ type: String }],
    notes: { type: String },
    
    followUpDates: [{ type: Date }],
    
    aiLeadScore: { type: Number },
    aiInsights: { type: String },
    qualificationStatus: { type: String },
    businessType: { type: String },
    budget: { type: String },
    urgency: { type: String },
    interest: { type: String },
    
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.models.Lead || mongoose.model<ILead>('Lead', LeadSchema);
