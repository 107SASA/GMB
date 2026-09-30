/**
 * What an account hard-purge does to every collection — pure data (runs under
 * `node --test`). tests/integration/account-purge-plan.test.ts fails if a model
 * exists in src/models without a decision here, so a new collection can never
 * silently escape (or silently fall into) the purge.
 *
 * Categories (from the erasure spec):
 *   a — personal data / conversation content → hard delete
 *   b — financial / billing records → kept (no personal fields) for the
 *       billing retention period, then removed
 *   c — aggregate / operational logs → deleted (not needed once the owner is gone)
 *
 * Scoping is ALWAYS by the purged user's own ids, the businesses they OWN,
 * and the leads / audits / customers of those businesses — never by a bare
 * organizationId (an organization can hold other people's workspaces).
 */

export const PURGE_GRACE_DAYS = 30;
export const BILLING_RETENTION_YEARS = 8;

export type PurgeKey = 'businessId' | 'userId' | 'leadId' | 'auditId';

export interface PurgeTarget {
  model: string;
  /** Field → which id set it is matched against. A document matching ANY listed field is deleted. */
  by: Partial<Record<string, PurgeKey>>;
  category: 'a' | 'c';
  what: string;
}

export const PURGE_TARGETS: PurgeTarget[] = [
  // ── a: the business's customers, leads and their conversations ──
  { model: 'Lead', by: { businessId: 'businessId' }, category: 'a', what: 'leads (names, phone numbers, notes)' },
  { model: 'Customer', by: { businessId: 'businessId' }, category: 'a', what: 'customer list' },
  { model: 'Conversation', by: { businessId: 'businessId', leadId: 'leadId' }, category: 'a', what: 'WhatsApp conversation messages' },
  { model: 'ConversationThread', by: { businessId: 'businessId', leadId: 'leadId' }, category: 'a', what: 'conversation threads' },
  { model: 'WhatsAppConversationSummary', by: { businessId: 'businessId', leadId: 'leadId' }, category: 'a', what: 'AI summaries of conversations' },
  { model: 'WhatsAppAppointment', by: { businessId: 'businessId', leadId: 'leadId' }, category: 'a', what: 'appointments booked over WhatsApp' },
  { model: 'Appointment', by: { businessId: 'businessId', leadId: 'leadId' }, category: 'a', what: 'appointments' },
  { model: 'BookingConversation', by: { leadId: 'leadId' }, category: 'a', what: 'booking-agent conversations' },
  { model: 'DemoBooking', by: { leadId: 'leadId' }, category: 'a', what: 'demo bookings from these leads' },
  { model: 'LeadEvent', by: { leadId: 'leadId' }, category: 'a', what: 'lead timeline events' },
  { model: 'Activity', by: { leadId: 'leadId' }, category: 'a', what: 'lead activity notes' },
  { model: 'FollowUp', by: { leadId: 'leadId' }, category: 'a', what: 'follow-up reminders' },
  { model: 'MessageQueue', by: { leadId: 'leadId' }, category: 'a', what: 'queued outbound messages' },
  { model: 'ScheduledAction', by: { leadId: 'leadId' }, category: 'a', what: 'scheduled lead actions' },
  { model: 'Campaign', by: { businessId: 'businessId' }, category: 'a', what: 'review-request campaigns' },
  { model: 'ReviewRequest', by: { businessId: 'businessId' }, category: 'a', what: 'review requests sent to customers' },
  // ── a: reviews, replies, content and media ──
  { model: 'Review', by: { businessId: 'businessId' }, category: 'a', what: 'synced Google reviews and replies' },
  { model: 'ReviewReply', by: { businessId: 'businessId' }, category: 'a', what: 'review reply drafts and audit rows' },
  { model: 'Post', by: { businessId: 'businessId' }, category: 'a', what: 'Google posts and drafts' },
  { model: 'GbpMediaAsset', by: { businessId: 'businessId' }, category: 'a', what: 'uploaded photos / videos (records; files deleted separately)' },
  { model: 'ShowcaseAsset', by: { businessId: 'businessId' }, category: 'a', what: 'success-story uploads' },
  { model: 'Testimonial', by: { businessId: 'businessId' }, category: 'a', what: 'testimonials submitted' },
  { model: 'FAQ', by: { businessId: 'businessId' }, category: 'a', what: 'FAQs' },
  { model: 'SEOContent', by: { businessId: 'businessId' }, category: 'a', what: 'generated SEO content' },
  { model: 'BusinessAIConfig', by: { businessId: 'businessId' }, category: 'a', what: 'AI agent configuration' },
  { model: 'WeeklyOffer', by: { businessId: 'businessId' }, category: 'a', what: 'owner offers' },
  // ── a: audits, reports and the owner's own conversations with GrowwMatics ──
  { model: 'Audit', by: { businessId: 'businessId', userId: 'userId' }, category: 'a', what: 'audits / reports' },
  { model: 'SeoPlan', by: { businessId: 'businessId' }, category: 'a', what: 'SEO plans' },
  { model: 'OptimizationAction', by: { businessId: 'businessId' }, category: 'a', what: 'optimization plan actions' },
  { model: 'ReportShare', by: { auditId: 'auditId' }, category: 'a', what: 'public report share links' },
  { model: 'SalesConversation', by: { businessId: 'businessId', auditId: 'auditId' }, category: 'a', what: 'sales-agent chats with the owner' },
  { model: 'ReportConversation', by: { businessId: 'businessId', auditId: 'auditId' }, category: 'a', what: 'report-agent chats' },
  { model: 'SupportConversation', by: { businessId: 'businessId', userId: 'userId' }, category: 'a', what: 'support chats' },
  // ── a: Google connection data ──
  { model: 'GBPToken', by: { businessId: 'businessId' }, category: 'a', what: 'Google OAuth tokens (revoked with Google first)' },
  { model: 'PendingGbpConnection', by: { businessId: 'businessId' }, category: 'a', what: 'pending Google connections' },
  { model: 'GBPInsights', by: { businessId: 'businessId' }, category: 'a', what: 'Google performance data' },
  { model: 'GBPKeyword', by: { businessId: 'businessId' }, category: 'a', what: 'Google search keywords' },
  { model: 'GBPKeywordIntel', by: { businessId: 'businessId' }, category: 'a', what: 'keyword intelligence' },
  { model: 'ProfileActivity', by: { businessId: 'businessId' }, category: 'a', what: 'profile edit history' },
  // ── a: the user's own account artefacts ──
  { model: 'LoginLink', by: { userId: 'userId' }, category: 'a', what: 'login links' },
  { model: 'Notification', by: { businessId: 'businessId', userId: 'userId' }, category: 'a', what: 'in-app notifications' },
  { model: 'OwnerNotifyDigest', by: { businessId: 'businessId', userId: 'userId' }, category: 'a', what: 'queued WhatsApp digests' },
  { model: 'UserLimitOverride', by: { userId: 'userId' }, category: 'a', what: 'admin limit overrides' },
  { model: 'FestivalPrompt', by: { businessId: 'businessId' }, category: 'a', what: 'festival prompts sent' },
  { model: 'WeeklyMonitor', by: { businessId: 'businessId' }, category: 'a', what: 'weekly monitoring summaries' },
  // ── c: aggregate / operational logs ──
  { model: 'ReviewMonitorLog', by: { businessId: 'businessId' }, category: 'c', what: 'review sync logs' },
  { model: 'ReviewAnalytics', by: { businessId: 'businessId' }, category: 'c', what: 'review statistics' },
  { model: 'AIUsageLog', by: { businessId: 'businessId', userId: 'userId' }, category: 'c', what: 'AI usage counters' },
  { model: 'ContentGenerationLog', by: { businessId: 'businessId', userId: 'userId' }, category: 'c', what: 'content generation logs' },
  { model: 'AutomationLog', by: { businessId: 'businessId' }, category: 'c', what: 'automation logs' },
  { model: 'UsageTracking', by: { userId: 'userId' }, category: 'c', what: 'usage counters' },
  { model: 'SubscriptionUsage', by: { businessId: 'businessId' }, category: 'c', what: 'plan usage counters' },
];

/** Collections the purge does not delete from — each with the reason. */
export const NOT_PURGED: Record<string, string> = {
  User: 'tombstoned: every field except _id/role/isDeleted/deletedAt/purgedAt is removed; email/phone replaced with unique placeholders',
  Business: 'tombstoned: only _id and billing identifiers (Razorpay subscription id/status/period) are kept for the billing retention period',
  Organization: 'tombstoned when no other active user or business remains in it',
  Subscription: 'category b: billing record (plan, dates, Razorpay ids, no personal fields) kept for BILLING_RETENTION_YEARS, then deleted',
  AccountPurgeLog: 'the erasure audit trail itself — ids and counts only',
  AdminActionLog: 'admin accountability log — ids only, no customer content',
  AdminInvite: 'admin (staff) invitations — not customer data',
  WebsiteIntelligence: 'public website facts keyed by domain — shared cache, not personal data',
  PlaceInsightCache: 'public Google Maps data keyed by place id — shared cache',
  KeywordVolumeCache: 'search-volume cache keyed by keyword — shared, not personal',
  LocalityCache: 'neighbourhood names keyed by coordinates — shared, not personal',
  JobQueue: 'short-lived job rows, pruned by dataRetentionCleanupCron',
  ProcessedWebhookEvent: 'webhook event ids for de-duplication (TTL)',
  BillingPlan: 'platform configuration',
  Plan: 'platform configuration',
  PlanConfig: 'platform configuration',
  PlatformSettings: 'platform configuration',
  OrchestrationConfig: 'platform configuration',
  ScoringRuleConfig: 'platform configuration',
  SalesAgentConfig: 'platform configuration',
  BookingAgentConfig: 'platform configuration',
  ReportAgentConfig: 'platform configuration',
  ContentTemplate: 'platform configuration',
};

/** Storage prefixes that belong to one business (all uploads are written under these). */
export const businessStoragePrefixes = (businessId: string) =>
  ['gbp-media', 'post-thumbnails', 'showcase', 'report-cards'].map((p) => `${p}/${businessId}/`);

/** Document fields holding URLs of files in our bucket (deleted with the records). */
export const STORAGE_URL_FIELDS: Array<{ model: string; field: string }> = [
  { model: 'GbpMediaAsset', field: 'url' },
  { model: 'Post', field: 'imageUrl' },
  { model: 'ShowcaseAsset', field: 'url' },
  { model: 'Testimonial', field: 'photoUrl' },
];

/** Business fields kept on the tombstone (billing identifiers only). */
export const BUSINESS_TOMBSTONE_KEEP = [
  '_id', 'isDeleted', 'deletedAt', 'purgedAt', 'createdAt', 'updatedAt', 'userId', 'organizationId',
  'razorpaySubscriptionId', 'subscriptionStatus', 'subscriptionCurrentPeriodEnd', 'subscriptionCancelAtPeriodEnd',
];

/** User fields kept on the tombstone. */
export const USER_TOMBSTONE_KEEP = ['_id', 'role', 'isDeleted', 'deletedAt', 'purgedAt', 'createdAt', 'updatedAt', '__v'];
