import mongoose, { Schema, Document } from 'mongoose';
import type { SalesAgentConfigShape } from '@/lib/salesAgentDefaults';

export interface ISalesAgentConfig extends SalesAgentConfigShape, Document {
  key: string; // singleton key: 'default'
  createdAt: Date;
  updatedAt: Date;
}

const FollowUpSchema = new Schema(
  {
    delayHours: { type: Number, default: 24 },
    mode: { type: String, enum: ['ai', 'template'], default: 'template' },
    template: { type: String, default: '' },
    aiSystemPrompt: { type: String, default: '' },
    onlyIfNoReply: { type: Boolean, default: true },
  },
  { _id: false }
);

// Optional grounded-knowledge block for the NBA executor AND the live
// persona / lead-intelligence extractor (which get a compact summary of it).
// Every field optional; an empty block means callers fall back safely rather
// than inventing facts. See SalesKnowledge in lib/salesAgentDefaults.ts.
//
// `useCases` is Mixed because it accepts BOTH the legacy plain-string form
// and the structured { name, problem, solution, benefit, idealCustomer,
// recommendedNextAction } form — normaliseUseCases() in salesAgentDefaults.ts
// flattens the two. Keeping it Mixed avoids a migration of existing configs.
const KnowledgeSchema = new Schema(
  {
    // Business context (new)
    businessOverview: { type: String, default: '' },
    idealCustomerProfile: { type: String, default: '' },
    targetCustomers: { type: [String], default: [] },
    customerProblems: { type: [String], default: [] },
    services: { type: [{ name: String, description: String }], default: [] },
    demoExplanation: { type: String, default: '' },
    subscriptionExplanation: { type: String, default: '' },
    limitations: { type: [String], default: [] },
    escalationRules: { type: String, default: '' },

    // Original five
    pricingResponse: { type: String, default: '' },
    objectionResponses: {
      PRICE: { type: String, default: '' },
      DECISION_MAKER: { type: String, default: '' },
      TIMING: { type: String, default: '' },
      TRUST: { type: String, default: '' },
      FEATURE_GAP: { type: String, default: '' },
      OTHER: { type: String, default: '' },
    },
    useCases: { type: [Schema.Types.Mixed], default: [] },
    faqs: { type: [{ q: String, a: String }], default: [] },
    educationPoints: { type: [String], default: [] },
  },
  { _id: false }
);

const SalesAgentConfigSchema: Schema = new Schema(
  {
    key: { type: String, default: 'default', unique: true },
    enabled: { type: Boolean, default: false },
    firstMessage: {
      mode: { type: String, enum: ['ai', 'template'], default: 'ai' },
      delayMinutes: { type: Number, default: 2 },
      template: { type: String, default: '' },
      aiSystemPrompt: { type: String, default: '' },
    },
    followUps: { type: [FollowUpSchema], default: [] },
    agentSystemPrompt: { type: String, default: '' },
    subscribeUrl: { type: String, default: '' },
    shopUrl: { type: String, default: '' },
    knowledge: { type: KnowledgeSchema, default: () => ({}) },
  },
  { timestamps: true }
);

export default mongoose.models.SalesAgentConfig ||
  mongoose.model<ISalesAgentConfig>('SalesAgentConfig', SalesAgentConfigSchema);
