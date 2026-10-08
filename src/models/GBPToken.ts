import mongoose, { Schema, Document } from 'mongoose';

export interface IGBPToken extends Document {
  businessId: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  googleAccountId: string;
  googleEmail: string;
  accessToken: string;   // stored encrypted
  refreshToken: string;  // stored encrypted
  expiresAt: Date;
  locationId: string;    // "accounts/{x}/locations/{y}"
  accountId: string;     // "accounts/{x}"
  scopes: string[];
  connectedAt: Date;
  lastSyncAt: Date | null;
  /**
   * Set once the one-time 6-month GBPInsights history backfill has run for
   * this business (see services/gbpInsightsBackfill.ts) — the regular sync
   * only ever pulls a rolling 28-day window, so without a real backfill the
   * Performance tab's "Last 6 Months" chart would otherwise only grow by
   * ~1 day of real history per calendar day since connecting. Checked (not
   * re-run) on every sync once set, so this never repeats for a business.
   */
  historyBackfilledAt?: Date | null;
  keywordSync?: { checkedAt: Date; months: Array<{ year: number; month: number; count: number; error?: string }> } | null;
  /**
   * Refresh-token health (FR-3.4). Set by getValidToken (lib/gbpClient.ts):
   * REVOKED only on Google's invalid_grant; cleared on every new connection
   * (finalizeGbpConnection / finalizeReportConnection). notifiedAt makes the
   * reconnect alert fire once per revocation, not on every sync.
   */
  authStatus?: {
    state: 'REVOKED' | 'REFRESH_FAILING';
    reason: 'REVOKED' | 'CONFIGURATION' | 'TEMPORARY';
    detectedAt: Date;
    lastFailureAt: Date;
    notifiedAt?: Date | null;
  } | null;
  /** Review sync bookkeeping (watermark + completeness) — see services/reviews/syncReviews.ts. */
  reviewSync?: {
    lastRunAt: Date;
    mode: 'full' | 'incremental';
    fetched: number;
    maxUpdateTime?: string | null;
    lastFullSyncAt?: Date | null;
    hitCap?: boolean;
    googleTotal?: number | null;
    conflicts?: number;
  } | null;
}

const GBPTokenSchema = new Schema<IGBPToken>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, unique: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    googleAccountId: { type: String, required: true },
    googleEmail: { type: String, required: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    locationId: { type: String, default: '' },
    accountId: { type: String, default: '' },
    scopes: [{ type: String }],
    connectedAt: { type: Date, default: Date.now },
    lastSyncAt: { type: Date, default: null },
    historyBackfilledAt: { type: Date, default: null },
    /** Last search-keyword sync: months asked for, terms returned, Google errors (shown on the dashboard). */
    keywordSync: { type: Schema.Types.Mixed, default: null },
    authStatus: { type: Schema.Types.Mixed, default: null },
    reviewSync: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.GBPToken ||
  mongoose.model<IGBPToken>('GBPToken', GBPTokenSchema);
