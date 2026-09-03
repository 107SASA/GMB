import mongoose, { Schema, Document } from 'mongoose';

// Declared separately (rather than inline in LeadSchema below) because its
// `type` field would otherwise collide with Mongoose's own SchemaType `type`
// key if written as a bare object literal — same reason FollowUpSchema is
// its own Schema in models/SalesAgentConfig.ts.
const ObjectionSchema = new Schema(
  {
    type: { type: String, enum: ['PRICE', 'DECISION_MAKER', 'TIMING', 'TRUST', 'FEATURE_GAP', 'OTHER'], required: true },
    note: { type: String },
    detectedAt: { type: Date, default: Date.now },
    resolved: { type: Boolean, default: false },
  },
  { _id: false }
);

export interface ILead extends Document {
  tenantId: string;
  organizationId?: string;
  businessId?: mongoose.Types.ObjectId;
  assignedUserId?: mongoose.Types.ObjectId;
  
  name: string;
  email?: string;
  phone?: string;
  source: 'WhatsApp' | 'Website' | 'Manual' | 'Instagram' | 'Facebook' | 'Referral' | 'Demo Booking' | 'Google Business Profile' | 'Phone Call' | 'Contacts Import';
  leadType: 'Client Prospect' | 'Platform Prospect';
  status: 'active' | 'inactive';
  lifeCycleStage: 'initial' | 'active' | 'closed' | 'converted';
  // Sub-stage name inside the current lifeCycleStage, from the business's
  // configurable leadStages (see Business.leadStages). Null = none picked.
  subStage: string | null;
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

  // --- Ownership/stage engine (shadow mode, LEAD_ENGINE_V2) -----------------
  // Single-source-of-truth fields being introduced alongside the existing
  // per-collection status enums (SalesConversation.status, etc). Nothing
  // reads these to make a routing/reply decision yet — they are written
  // observationally by services/leadOwnership/setLeadOwnership.ts, called
  // from the webhook route AFTER the real (legacy) routing decision has
  // already run. Any FUTURE phase that reads these fields to decide who
  // replies to a lead MUST gate that on process.env.LEAD_ENGINE_V2 === 'true'
  // first — see the call site in app/api/whatsapp/webhook/route.ts for why.
  currentAgent?: 'NONE' | 'SALES' | 'DEMO' | 'IN_HOUSE' | 'HUMAN';
  currentStage?:
    | 'NEW'
    | 'QUALIFYING'
    | 'NURTURING'
    | 'DEMO_REQUESTED'
    | 'DEMO_SCHEDULED'
    | 'DEMO_COMPLETED'
    | 'CONVERSION_PENDING'
    | 'PAYMENT_VERIFIED'
    | 'CUSTOMER'
    | 'COLD'
    | 'UNRESPONSIVE'
    | 'LONG_TERM_NURTURE'
    | 'LOST'
    | 'DO_NOT_CONTACT'
    | 'HUMAN_HANDOFF';
  nurtureStatus?: 'ACTIVE' | 'PAUSED' | 'STOPPED' | 'OPTED_OUT';
  humanHandoff?: {
    active: boolean;
    reason?: string;
    assignedUserId?: mongoose.Types.ObjectId;
    since?: Date;
  };

  // --- Lead intelligence (shadow mode, written by leadIntelligence/extract.ts) --
  // leadScore is a DELIBERATELY SEPARATE number from the existing aiLeadScore
  // above: aiLeadScore is a one-shot AI qualification judgment (0-100,
  // Hot/Warm/Cold) computed once by the generic CRM follow-up chain in
  // services/inngest/functions.ts; leadScore is an incremental score built
  // up over time from discrete WhatsApp signal events (ScoringRuleConfig
  // deltas — see that model). They measure different things and are kept
  // fully independent; nothing in this phase reads or writes aiLeadScore.
  leadScore?: number;
  intent?:
    | 'EXPLORING'
    | 'LEARNING'
    | 'PROBLEM_AWARE'
    | 'SOLUTION_AWARE'
    | 'DEMO_INTEREST'
    | 'PURCHASE_INTEREST'
    | 'READY_TO_BUY'
    | 'NOT_INTERESTED';
  objections?: {
    type: 'PRICE' | 'DECISION_MAKER' | 'TIMING' | 'TRUST' | 'FEATURE_GAP' | 'OTHER';
    note?: string;
    detectedAt: Date;
    resolved: boolean;
  }[];
  painPoints?: string[];
  businessProfile?: {
    industry?: string;
    businessType?: string;
    goals?: string[];
    interestedServices?: string[];
  };
  lastMeaningfulInteractionAt?: Date;
  // Internal bookkeeping for ScoringRuleConfig's REPLIED signal, which is
  // spec'd as "+3, cap once/day" — not a field the task asked for by name,
  // but needed to make that cap real rather than left to the model's
  // discretion (an LLM has no memory of "already scored a reply today").
  // See leadIntelligence/extract.ts's applyExtraction.
  lastRepliedScoreAt?: Date;
  // Phase 8 — rolling window of the last few Phase 3 extraction confidence
  // scores, oldest first, capped at 2 entries (only the last 2 matter for
  // the "two consecutive low-confidence turns" human-handoff trigger — see
  // services/agentHandoff/checkHandoffTriggers.ts). Written by
  // leadIntelligence/extract.ts's applyExtraction alongside every other
  // per-message field it already updates. PURELY TRANSIENT trigger-detector
  // state, not lead-intelligence history — cleared on release-to-AI (see
  // services/leadOwnership/releaseFromHuman.ts) so stale low-confidence
  // turns from before a handoff can't immediately re-trigger it after
  // release with zero new evidence.
  recentExtractionConfidences?: number[];
  // Behavioral-signature idempotency for leadScore — see the schema
  // definition below and leadIntelligence/extract.ts's applyExtraction.
  // Each entry: `${score_signal}:${hash(normalized message text)}`.
  scoredSignalKeys?: string[];
  // P0 fix (post-implementation-audit) — snapshot of
  // SalesConversation.followUpsSent taken at the moment a lead is released
  // from HUMAN back to an agent. NOT a reset of followUpsSent itself
  // (that field is real nurture-cycle history and is never touched) — this
  // is a separate baseline the "stuck hot lead" trigger subtracts before
  // comparing against its cyclesThreshold, so the trigger only counts
  // follow-ups sent AFTER the release as fresh evidence, not the same
  // pre-release count that caused the original handoff. See
  // services/agentHandoff/checkHandoffTriggers.ts and
  // services/leadOwnership/releaseFromHuman.ts.
  followUpsSentAtRelease?: number;

  // --- Next-best-action engine (decision only — Phase 4 does NOT send) -----
  // Written by services/nba/decideNextAction.ts. Nothing sends a message
  // because of these fields yet — that's a later phase. See that file's
  // doc comment.
  nextBestAction?:
    | 'ASK_QUALIFICATION'
    | 'EDUCATE'
    | 'SHARE_USE_CASE'
    | 'ANSWER_QUESTION'
    | 'HANDLE_OBJECTION'
    | 'SHOW_VALUE'
    | 'OFFER_DEMO'
    | 'SCHEDULE_DEMO'
    | 'SEND_PRICING'
    | 'FOLLOW_UP_AFTER_DEMO'
    | 'OFFER_SUBSCRIPTION'
    | 'REENGAGE'
    | 'WAIT'
    | 'HUMAN_HANDOFF'
    | 'STOP'
    | null;
  nextActionAt?: Date | null;
  // Set by services/orchestration/outboundOrchestrator.ts every time it
  // successfully sends a non-reply (agent-initiated/proactive) message —
  // the cooldown signal for "another agent-initiated message was sent to
  // this lead within the window," regardless of whether that send was
  // scheduled via ScheduledAction or sent directly through the
  // orchestrator. Never set for reply-triggered sends (isReply: true).
  lastProactiveMessageAt?: Date;

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
      enum: ['WhatsApp', 'Website', 'Manual', 'Instagram', 'Facebook', 'Referral', 'Demo Booking', 'Google Business Profile', 'Phone Call', 'Contacts Import'],
      default: 'Manual'
    },
    leadType: {
      type: String,
      enum: ['Client Prospect', 'Platform Prospect'],
      default: 'Client Prospect'
    },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    lifeCycleStage: {
      type: String,
      enum: ['initial', 'active', 'closed', 'converted'],
      default: 'initial',
    },
    subStage: { type: String, default: null },
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

    // --- Ownership/stage engine (shadow mode, LEAD_ENGINE_V2) ---------------
    // All optional with safe defaults so existing Lead documents (none of
    // which have these fields set) load and behave exactly as before —
    // Mongoose applies the `default` on read for docs missing the field.
    currentAgent: {
      type: String,
      enum: ['NONE', 'SALES', 'DEMO', 'IN_HOUSE', 'HUMAN'],
      default: 'NONE',
    },
    currentStage: {
      type: String,
      enum: [
        'NEW', 'QUALIFYING', 'NURTURING', 'DEMO_REQUESTED', 'DEMO_SCHEDULED',
        'DEMO_COMPLETED', 'CONVERSION_PENDING', 'PAYMENT_VERIFIED', 'CUSTOMER',
        'COLD', 'UNRESPONSIVE', 'LONG_TERM_NURTURE', 'LOST', 'DO_NOT_CONTACT',
        'HUMAN_HANDOFF',
      ],
      default: 'NEW',
    },
    nurtureStatus: {
      type: String,
      enum: ['ACTIVE', 'PAUSED', 'STOPPED', 'OPTED_OUT'],
      default: 'ACTIVE',
    },
    humanHandoff: {
      active: { type: Boolean, default: false },
      reason: { type: String },
      assignedUserId: { type: Schema.Types.ObjectId, ref: 'User' },
      since: { type: Date },
    },

    // --- Lead intelligence (shadow mode) ------------------------------------
    // See the ILead interface comment above for why leadScore is kept fully
    // separate from aiLeadScore rather than replacing/mirroring it.
    leadScore: { type: Number, default: 0, min: 0, max: 100 },
    intent: {
      type: String,
      enum: [
        'EXPLORING', 'LEARNING', 'PROBLEM_AWARE', 'SOLUTION_AWARE',
        'DEMO_INTEREST', 'PURCHASE_INTEREST', 'READY_TO_BUY', 'NOT_INTERESTED',
      ],
      default: 'EXPLORING',
    },
    objections: { type: [ObjectionSchema], default: [] },
    painPoints: { type: [String], default: [] },
    businessProfile: {
      industry: { type: String },
      businessType: { type: String },
      goals: { type: [String], default: [] },
      interestedServices: { type: [String], default: [] },
    },
    lastMeaningfulInteractionAt: { type: Date },
    lastRepliedScoreAt: { type: Date },
    recentExtractionConfidences: { type: [Number], default: [] },
    // Behavioral-signature idempotency for leadScore. Each entry is
    // `${score_signal}:${hash(normalized message text)}` for a score delta
    // that has already been applied — re-processing the same inbound
    // message/intent/signal (an Inngest retry, a scheduler re-tick, a
    // scripted re-send) is then a no-op instead of stacking another +N.
    // A genuinely NEW message produces a new hash; a genuinely new signal
    // (DEMO_BOOKED after DEMO_REQUESTED, PURCHASE_INTENT, …) a new key — both
    // still score normally. Capped to the most recent entries; see
    // leadIntelligence/extract.ts's applyExtraction.
    scoredSignalKeys: { type: [String], default: [] },
    followUpsSentAtRelease: { type: Number },

    // --- Next-best-action engine (decision only) ----------------------------
    nextBestAction: {
      type: String,
      enum: [
        'ASK_QUALIFICATION', 'EDUCATE', 'SHARE_USE_CASE', 'ANSWER_QUESTION',
        'HANDLE_OBJECTION', 'SHOW_VALUE', 'OFFER_DEMO', 'SCHEDULE_DEMO',
        'SEND_PRICING', 'FOLLOW_UP_AFTER_DEMO', 'OFFER_SUBSCRIPTION',
        'REENGAGE', 'WAIT', 'HUMAN_HANDOFF', 'STOP', null,
      ],
      default: null,
    },
    nextActionAt: { type: Date, default: null },
    lastProactiveMessageAt: { type: Date },

    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.models.Lead || mongoose.model<ILead>('Lead', LeadSchema);
