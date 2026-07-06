import mongoose, { Schema, Document } from 'mongoose';

export type ModuleKey = 
  | 'google_ranking_agent' 
  | 'reputation_agent' 
  | 'sales_agent' 
  | 'content_studio' 
  | 'marketing_automation';

export interface ISubscription extends Document {
  userId: mongoose.Types.ObjectId;
  planType: 'Free' | 'Pro' | 'Enterprise';
  billingStatus: 'Active' | 'PastDue' | 'Canceled' | 'Trialing';
  trialStatus: {
    isActive: boolean;
    endsAt?: Date;
  };
  modules: {
    [key in ModuleKey]?: {
      enabled: boolean;
      activatedAt: Date;
    }
  };
  // New fields for Phase 1 Migration
  businessId?: mongoose.Types.ObjectId;
  planId?: mongoose.Types.ObjectId;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  // Razorpay linkage (website billing) — additive
  razorpaySubscriptionId?: string;
  currentPeriodEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    planType: { type: String, enum: ['Free', 'Pro', 'Enterprise'], default: 'Free' },
    billingStatus: { type: String, enum: ['Active', 'PastDue', 'Canceled', 'Trialing'], default: 'Trialing' },
    trialStatus: {
      isActive: { type: Boolean, default: true },
      endsAt: { type: Date, default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) } // 14 day trial
    },
    modules: {
      google_ranking_agent: { enabled: { type: Boolean, default: true }, activatedAt: { type: Date, default: Date.now } },
      reputation_agent: { enabled: { type: Boolean, default: false }, activatedAt: { type: Date } },
      sales_agent: { enabled: { type: Boolean, default: false }, activatedAt: { type: Date } },
      content_studio: { enabled: { type: Boolean, default: false }, activatedAt: { type: Date } },
      marketing_automation: { enabled: { type: Boolean, default: false }, activatedAt: { type: Date } }
    },
    // New fields for Phase 1 Migration
    businessId: { type: Schema.Types.ObjectId, ref: 'Business' },
    planId: { type: Schema.Types.ObjectId, ref: 'Plan' },
    status: { type: String, default: 'active' },
    startDate: { type: Date },
    endDate: { type: Date },
    // Razorpay linkage (website billing) — additive
    razorpaySubscriptionId: { type: String, index: true, sparse: true },
    currentPeriodEnd: { type: Date }
  },
  { timestamps: true }
);

export default mongoose.models.Subscription || mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
