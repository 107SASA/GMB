import mongoose, { Schema, Document } from 'mongoose';

/**
 * Singleton config (same `key: 'default'` pattern as SalesAgentConfig /
 * ScoringRuleConfig) for the Phase 5 outbound orchestrator. Two purposes:
 *
 * 1. cooldownHours — the configurable proactive-message cooldown window
 *    (task requirement: "read from an env var or a config doc, don't
 *    hardcode only in code"). ORCHESTRATOR_COOLDOWN_HOURS env var wins if
 *    set (ops-level override without a DB write); otherwise this doc's
 *    value; otherwise the DEFAULT_COOLDOWN_HOURS fallback below. See
 *    getCooldownHours() in services/orchestration/outboundOrchestrator.ts.
 *
 * 2. Cohort rollout — the simplest mechanism this codebase can support
 *    without a new admin page this phase: a plain allowlist array plus an
 *    optional percentage rollout, both on this one doc.
 *      - leadIdAllowlist: exact leadIds always in the cohort, regardless of
 *        percentage — the way to test on "a handful of real leads" the task
 *        asks for. Edit directly via mongosh/Compass/a script for now
 *        (`db.orchestrationconfigs.updateOne({key:'default'}, {$addToSet:
 *        {leadIdAllowlist: ObjectId('...')}})`); a real admin UI is a later
 *        phase's concern, not this one's.
 *      - rolloutPercentage (0-100): a lead not on the allowlist is in the
 *        cohort if a stable hash of its _id falls under this percentage —
 *        stable per-lead (same lead always gets the same yes/no at a fixed
 *        percentage) rather than random-per-call, so a lead doesn't flicker
 *        in and out of the cohort from one message to the next. See
 *        isLeadInCohort() in outboundOrchestrator.ts.
 *      - Defaults to an empty allowlist and 0% — LEAD_ENGINE_V2 being 'true'
 *        alone does NOT put any lead in the cohort; both gates must pass.
 */
export interface IOrchestrationConfig extends Document {
  key: string; // singleton key: 'default'
  cooldownHours?: number;
  leadIdAllowlist: mongoose.Types.ObjectId[];
  rolloutPercentage: number;
  // Phase 8 — human-handoff trigger threshold: a lead with leadScore >=
  // stuckLeadScoreThreshold that has gone through
  // stuckNurtureCyclesThreshold sales follow-ups (SalesConversation.
  // followUpsSent) with no currentStage progression is considered "stuck
  // hot" and handed to a human rather than kept in the AI drip forever.
  // See services/agentHandoff/checkHandoffTriggers.ts. Read from this doc
  // (not hardcoded) per the task's explicit requirement.
  stuckLeadScoreThreshold: number;
  stuckNurtureCyclesThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

const OrchestrationConfigSchema: Schema = new Schema(
  {
    key: { type: String, default: 'default', unique: true },
    cooldownHours: { type: Number },
    leadIdAllowlist: { type: [Schema.Types.ObjectId], default: [] },
    rolloutPercentage: { type: Number, default: 0, min: 0, max: 100 },
    stuckLeadScoreThreshold: { type: Number, default: 76 },
    stuckNurtureCyclesThreshold: { type: Number, default: 3 },
  },
  { timestamps: true }
);

export default mongoose.models.OrchestrationConfig ||
  mongoose.model<IOrchestrationConfig>('OrchestrationConfig', OrchestrationConfigSchema);
