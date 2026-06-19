import mongoose, { Schema, Document } from 'mongoose';

export interface IPlan extends Document {
  name: string;
  price: number;
  billingCycle: 'monthly' | 'yearly';
  maxPosts: number; // -1 for unlimited
  maxAudits: number; // -1 for unlimited
  maxBusinesses: number; // -1 for unlimited
  features: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PlanSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
    maxPosts: { type: Number, required: true },
    maxAudits: { type: Number, required: true },
    maxBusinesses: { type: Number, required: true },
    features: [{ type: String }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.models.Plan || mongoose.model<IPlan>('Plan', PlanSchema);
