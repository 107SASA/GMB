import mongoose, { Schema, Document } from 'mongoose';

export interface IBusiness extends Document {
  name: string;
  category: string;
  description?: string;
  address: string;
  area?: string;
  city?: string;
  state?: string;
  country?: string;
  googleMapsUrl?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  services?: string;
  offers?: string;
  tone?: string;
  phone?: string;
  website?: string;
  rating: number;
  reviewCount: number;
  /**
   * Point-in-time rating/review-count snapshot captured from the Google
   * Places Details API at free-report intake (see src/lib/shadowAccount.ts).
   * Distinct from `rating`/`reviewCount` above (which are meant to reflect a
   * live-synced GBP value) — these are a one-off read taken when the visitor
   * picked their listing from autocomplete, NOT kept in sync afterward.
   * Used only as a display/report fallback for businesses that have no
   * synced Review documents yet (e.g. every free-report lead, since fastMode
   * audits skip review sync — see auditService.ts). Never used to feed
   * per-review scoring (quality/keyword-coverage), which still requires
   * real Review documents.
   */
  placesRating?: number;
  placesReviewCount?: number;
  placeId?: string;
  serpApiDataId?: string;
  photoCount?: number;
  hasHours?: boolean;
  googlePlaceId?: string;
  googleLocationId?: string;
  userDefinedCategory?: string;
  googleAccountId?: string;
  googleTypes?: string[];
  googleConnected: boolean;
  keywords: string[];
  competitors: mongoose.Types.ObjectId[];
  organizationId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  integrations: {
    whatsappNumber?: string;
  };
  metaBusinessProfileUrl?: string;
  facebookPageUrl?: string;
  instagramUrl?: string;
  whatsappConfig: {
    provider: string;
    businessPhone?: string;
    metaProfileUrl?: string;
    /** Meta Cloud API Phone Number ID — maps inbound webhooks to this business. */
    phoneNumberId?: string;
    /** Meta WhatsApp Business Account (WABA) ID. */
    wabaId?: string;
    isConnected: boolean;
  };
  aiSettings: {
    tone: string;
    salesPrompt?: string;
    replyStyle?: string;
    leadQualificationBehavior?: string;
  };
  reviewAutomationSettings: {
    enabled: boolean;
    reminderDays: number;
    messageTemplate?: string;
  };
  // How incoming reviews get replied to (Review Management screen) —
  // 'manual' (default): AI drafts a reply, the owner reviews/edits/approves
  // before it posts. 'auto': the AI agent drafts AND posts on its own, no
  // human step. Read by syncReviewsForBusiness (see services/reviews/) right
  // after new reviews are upserted, and by the reply-settings route when the
  // owner switches modes (to catch up the existing backlog of unreplied
  // reviews, not just future ones).
  reviewReplySettings: {
    mode: 'manual' | 'auto';
    tone: string;
  };
  kanbanColumns: string[];
  // ADDITIVE — configurable Lead Stages (sales pipeline). Main stages are
  // fixed (initial/active/converted/closed, matching Lead.lifeCycleStage);
  // owners manage sub-stages inside every main stage except 'initial'.
  // Missing config means "use DEFAULT_LEAD_STAGES" (see src/lib/leadStages.ts).
  leadStages?: {
    initialLabel: string;
    active: Array<{ name: string; color: string }>;
    converted: Array<{ name: string; color: string }>;
    closed: Array<{ name: string; color: string }>;
  };
  onboardingCompleted: boolean;
  faqs?: Array<{ question: string; answer: string }>;
  isDeleted?: boolean;
  // ADDITIVE — set only on businesses created via a shadow-account lead-gen
  // flow (see src/lib/shadowAccount.ts), e.g. 'free-report-form'. Undefined
  // for every business created through the normal onboarding wizard.
  provisionedVia?: string;
  // ADDITIVE — per-workspace subscription gate. Each workspace (Business) must
  // have its own active subscription before its dashboard is accessible. New
  // workspaces default to 'trialing' + freeAuditUsed:false, so they get exactly
  // one free GBP audit, after which the dashboard locks until subscribed.
  // Enforced centrally in src/proxy.ts. Owner (SUPER_ADMIN) accounts bypass it.
  subscriptionStatus?: 'trialing' | 'active' | 'past_due' | 'canceled';
  freeAuditUsed?: boolean;
  /**
   * GrowwMatics' OWN sales pipeline stage for this workspace (admin CRM) —
   * distinct from `kanbanColumns`/`Lead.pipelineStage`, which are the
   * business owner's stages for THEIR OWN customers. Unset until the free
   * audit completes (→ 'Lead'); set to 'Customer' the moment the workspace's
   * subscription activates. Free-form string so it stays in sync with
   * whatever columns the admin has configured in PlatformSettings.
   */
  pipelineStage?: string;
  razorpaySubscriptionId?: string;
  subscriptionCurrentPeriodEnd?: Date;
  /** True after the owner cancels: stays 'active' until the period ends (no
   *  refund — access continues to the paid-through date), then downgrades. */
  subscriptionCancelAtPeriodEnd?: boolean;
  /** Day-thresholds (10/5/3/2/1) already reminded, so we don't double-notify. */
  subscriptionRemindersSent?: number[];
  /** When the post-audit WhatsApp sales nurture was sent (send-once guard). */
  auditNurtureSentAt?: Date;
  /** When the "your report is ready" WhatsApp ping was sent (send-once guard). */
  reportReadySentAt?: Date;
  // ADDITIVE — post-payment intake. Rich marketing info collected right after a
  // workspace subscribes, so audits, content and competitor comparison run on
  // real data instead of empty/garbage fields. `intakeCompleted` gates the
  // dashboard (src/proxy.ts) until the owner fills this in once.
  intakeCompleted?: boolean;
  intake?: {
    uniqueSellingPoints?: string;
    targetAudience?: string;
    competitorNames?: string[];
    primaryGoal?: string;
  };
  // ADDITIVE — weekly content autopilot anchor (see weeklyContentAutopilot in
  // services/inngest/functions.ts). Set ONCE, the first time this workspace
  // has both an active subscription AND a connected Google Business Profile
  // (whichever completes second) — never reset by a later GBP disconnect/
  // reconnect or subscription lapse/resume, so the weekly cadence stays
  // anchored to that original day. Undefined means "not started yet" (either
  // genuinely new, or a pre-existing business from before this feature
  // existed — the autopilot cron treats both the same: start on its next pass).
  autopilotNextRunAt?: Date;
  // ADDITIVE — WhatsApp AI Agent booking configuration (Feature 1).
  // Opt-in only: bookingEnabled defaults to false so existing businesses
  // are completely unaffected until they explicitly configure this.
  whatsappBookingSettings?: {
    bookingEnabled: boolean;
    timezone: string;
    workingDays: {
      monday: boolean;
      tuesday: boolean;
      wednesday: boolean;
      thursday: boolean;
      friday: boolean;
      saturday: boolean;
      sunday: boolean;
    };
    openingTime: string; // 24hr "HH:mm"
    closingTime: string; // 24hr "HH:mm"
    slotDurationMinutes: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Sub-stage of a main lead stage (see leadStages below).
const LeadSubStageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    color: { type: String, default: 'slate' },
  },
  { _id: false }
);

const BusinessSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    category: { type: String, required: true },
    description: { type: String },
    address: { type: String, required: true },
    area: { type: String },
    city: { type: String },
    state: { type: String },
    country: { type: String },
    googleMapsUrl: { type: String },
    coordinates: {
      lat: { type: Number },
      lng: { type: Number }
    },
    services: { type: String },
    offers: { type: String },
    tone: { type: String, default: 'professional' },
    phone: { type: String },
    website: { type: String },
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    // ADDITIVE — see placesRating/placesReviewCount in IBusiness above.
    placesRating: { type: Number },
    placesReviewCount: { type: Number },
    // NOT globally unique — see the compound index at the bottom of this file.
    // A single Google Business Profile can legitimately be managed by more than
    // one tenant (the owner and their agency, for example).
    placeId: { type: String, index: true },
    serpApiDataId: { type: String },
    photoCount: { type: Number },
    hasHours: { type: Boolean },
    googlePlaceId: { type: String },
    googleLocationId: { type: String },
    userDefinedCategory: { type: String },
    googleAccountId: { type: String },
    googleTypes: [{ type: String }],
    googleConnected: { type: Boolean, default: false },
    keywords: [{ type: String }],
    competitors: [{ type: Schema.Types.ObjectId, ref: 'Business' }],
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    integrations: {
      whatsappNumber: { type: String }
    },
    metaBusinessProfileUrl: { type: String },
    facebookPageUrl: { type: String },
    instagramUrl: { type: String },
    whatsappConfig: {
      provider: { type: String, default: 'meta' },
      businessPhone: { type: String },
      metaProfileUrl: { type: String },
      phoneNumberId: { type: String },
      wabaId: { type: String },
      isConnected: { type: Boolean, default: false }
    },
    aiSettings: {
      tone: { type: String, default: 'professional' },
      salesPrompt: { type: String },
      replyStyle: { type: String },
      leadQualificationBehavior: { type: String }
    },
    reviewAutomationSettings: {
      enabled: { type: Boolean, default: false },
      reminderDays: { type: Number, default: 3 },
      messageTemplate: { type: String }
    },
    reviewReplySettings: {
      mode: { type: String, enum: ['manual', 'auto'], default: 'manual' },
      tone: { type: String, default: 'Professional' },
    },
    kanbanColumns: [{ type: String }],
    // ADDITIVE — see leadStages in IBusiness above. No default object is
    // forced onto existing documents; routes fall back to DEFAULT_LEAD_STAGES.
    leadStages: {
      type: new Schema(
        {
          initialLabel: { type: String, default: 'Open' },
          active: { type: [LeadSubStageSchema], default: [] },
          converted: { type: [LeadSubStageSchema], default: [] },
          closed: { type: [LeadSubStageSchema], default: [] },
        },
        { _id: false }
      ),
      default: undefined,
    },
    onboardingCompleted: { type: Boolean, default: false },
    faqs: [{ question: { type: String }, answer: { type: String } }],
    isDeleted: { type: Boolean, default: false },
    // ADDITIVE — see provisionedVia in IBusiness above.
    provisionedVia: { type: String },
    // ADDITIVE — per-workspace subscription gate (see IBusiness above).
    subscriptionStatus: {
      type: String,
      enum: ['trialing', 'active', 'past_due', 'canceled'],
      default: 'trialing',
    },
    freeAuditUsed: { type: Boolean, default: false },
    // ADDITIVE — GrowwMatics' own sales pipeline stage (see IBusiness above).
    pipelineStage: { type: String, index: true },
    razorpaySubscriptionId: { type: String, index: true, sparse: true },
    subscriptionCurrentPeriodEnd: { type: Date },
    subscriptionCancelAtPeriodEnd: { type: Boolean, default: false },
    subscriptionRemindersSent: { type: [Number], default: [] },
    // ADDITIVE — when the post-audit WhatsApp sales nurture was sent (send-once).
    auditNurtureSentAt: { type: Date },
    reportReadySentAt: { type: Date },
    // ADDITIVE — post-payment intake (see IBusiness above).
    intakeCompleted: { type: Boolean, default: false },
    intake: {
      uniqueSellingPoints: { type: String },
      targetAudience: { type: String },
      competitorNames: [{ type: String }],
      primaryGoal: { type: String },
    },
    // ADDITIVE — weekly content autopilot anchor (see IBusiness above).
    autopilotNextRunAt: { type: Date },
    // ADDITIVE — see whatsappBookingSettings in IBusiness above. Not required,
    // no default object is forced onto existing documents; the WhatsApp
    // appointment agent treats a missing/disabled config as "booking off".
    whatsappBookingSettings: {
      bookingEnabled: { type: Boolean, default: false },
      timezone: { type: String, default: 'Asia/Kolkata' },
      workingDays: {
        monday: { type: Boolean, default: true },
        tuesday: { type: Boolean, default: true },
        wednesday: { type: Boolean, default: true },
        thursday: { type: Boolean, default: true },
        friday: { type: Boolean, default: true },
        saturday: { type: Boolean, default: true },
        sunday: { type: Boolean, default: false },
      },
      openingTime: { type: String, default: '09:00' },
      closingTime: { type: String, default: '18:00' },
      slotDurationMinutes: { type: Number, default: 30 },
    },
  },
  { timestamps: true }
);

// Hot lookup paths. `userId` is hit on every login (Business.findOne({ userId }))
// and by the user's business-list routes; `organizationId` (required) scopes
// almost every tenant query. Without these, those become collection scans.
BusinessSchema.index({ userId: 1 });
BusinessSchema.index({ organizationId: 1 });

/**
 * placeId is unique PER TENANT, not globally.
 *
 * It used to be `unique: true` on the field itself, which meant the first
 * customer to connect a given Google Business Profile permanently blocked every
 * other customer from connecting it — signup died with a raw
 * "E11000 duplicate key error ... placeId_1". Two different accounts managing
 * the same profile is legitimate (business owner + their agency), so the
 * constraint belongs at the organization level: it still stops one tenant
 * adding the same profile twice.
 *
 * partialFilterExpression (rather than `sparse`) so businesses without a
 * placeId — manual entries — are excluded from the constraint entirely.
 */
BusinessSchema.index(
  { organizationId: 1, placeId: 1 },
  {
    unique: true,
    partialFilterExpression: { placeId: { $type: 'string' } },
    name: 'org_placeId_unique',
  }
);

export default mongoose.models.Business || mongoose.model<IBusiness>('Business', BusinessSchema);