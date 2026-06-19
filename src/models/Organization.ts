import mongoose, { Schema, Document } from 'mongoose';

export interface IOrganization extends Document {
  name: string;
  ownerId: mongoose.Types.ObjectId;
  subscriptionPlan: 'Free' | 'Pro' | 'Enterprise';
  status: 'Active' | 'Suspended' | 'Cancelled';
  billingId?: string;
  maxBusinesses: number;
  settings: {
    whiteLabel: boolean;
    customDomain?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subscriptionPlan: { 
      type: String, 
      enum: ['Free', 'Pro', 'Enterprise'], 
      default: 'Free' 
    },
    status: {
      type: String,
      enum: ['Active', 'Suspended', 'Cancelled'],
      default: 'Active'
    },
    billingId: { type: String },
    maxBusinesses: { type: Number, default: 1 },
    settings: {
      whiteLabel: { type: Boolean, default: false },
      customDomain: { type: String }
    }
  },
  { timestamps: true }
);

export default mongoose.models.Organization || mongoose.model<IOrganization>('Organization', OrganizationSchema);
