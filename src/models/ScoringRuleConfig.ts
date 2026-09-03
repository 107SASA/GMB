import mongoose, { Schema, Document } from 'mongoose';

/**
 * Singleton config (same pattern as SalesAgentConfig/BookingAgentConfig/
 * ReportAgentConfig — `key: 'default'`) holding the delta table
 * leadIntelligence/extract.ts applies to Lead.leadScore when Groq's
 * extraction returns a `score_signal`. Kept editable/data-driven rather than
 * hardcoded so a later admin page can tune deltas without a deploy, same
 * reasoning as the other *AgentConfig singletons.
 *
 * INACTIVITY_DECAY is listed here for completeness of the signal table, but
 * nothing in this phase applies it automatically (that needs a scheduled
 * job walking idle leads, which is out of scope here) — extract.ts only
 * ever applies whichever single signal Groq returns for the message it was
 * just given.
 */
export interface IScoringRule {
  signal: string;
  delta: number;
}

export interface IScoringRuleConfig extends Document {
  key: string; // singleton key: 'default'
  rules: IScoringRule[];
  createdAt: Date;
  updatedAt: Date;
}

const ScoringRuleSchema = new Schema(
  {
    signal: { type: String, required: true },
    delta: { type: Number, required: true },
  },
  { _id: false }
);

// Defaults exactly as specified — also exported so extract.ts (and a future
// admin page) can seed/reset against the same source of truth rather than a
// second hardcoded copy.
export const DEFAULT_SCORING_RULES: IScoringRule[] = [
  { signal: 'FREE_REPORT_SUBMITTED', delta: 10 },
  { signal: 'REPLIED', delta: 3 }, // capped once/day — enforced by the caller, not this table
  { signal: 'BUSINESS_INFO_PROVIDED', delta: 8 },
  { signal: 'PRODUCT_QUESTION', delta: 5 },
  { signal: 'PRICING_QUESTION', delta: 15 },
  { signal: 'IMPLEMENTATION_QUESTION', delta: 15 },
  { signal: 'DEMO_REQUESTED', delta: 20 },
  { signal: 'DEMO_BOOKED', delta: 20 },
  { signal: 'DEMO_ATTENDED', delta: 15 },
  { signal: 'PURCHASE_INTENT', delta: 25 },
  { signal: 'EXPLICIT_REJECTION', delta: -30 },
  { signal: 'INACTIVITY_DECAY', delta: -2 }, // per idle day after 5 idle days, floor 0 — not auto-applied yet, see file comment
];

const ScoringRuleConfigSchema: Schema = new Schema(
  {
    key: { type: String, default: 'default', unique: true },
    rules: { type: [ScoringRuleSchema], default: DEFAULT_SCORING_RULES },
  },
  { timestamps: true }
);

export default mongoose.models.ScoringRuleConfig ||
  mongoose.model<IScoringRuleConfig>('ScoringRuleConfig', ScoringRuleConfigSchema);
