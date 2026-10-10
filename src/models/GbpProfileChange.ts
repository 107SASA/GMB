import mongoose, { Schema, Document, Model } from 'mongoose';
import { OPEN_KEY_STATUSES } from '@/services/gbp/changes/policy';

/**
 * One proposed Google Business Profile edit (FR-5.10).
 * This is the authorization and execution record. OptimizationAction remains
 * a recommendation and is not a Google write.
 */
export type GbpChangeStatus =
  | 'PROPOSED' | 'APPROVED' | 'EXECUTING' | 'APPLIED' | 'VERIFIED'
  | 'FAILED' | 'REVERTED' | 'BLOCKED' | 'CONFLICT' | 'UNRESOLVED';

export interface IGbpProfileChange extends Document {
  businessId: mongoose.Types.ObjectId;
  organizationId?: string | null;
  locationId: string;
  kind: string;
  fields: string[];
  sensitive: boolean;
  source: string;
  before: unknown;
  proposed: unknown;
  after: unknown;
  beforeFingerprint: string;
  afterFingerprint?: string | null;
  status: GbpChangeStatus;
  validation: { valid: boolean; violations: Array<{ code: string; message: string }> };
  requestedBy: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  executedAt?: Date | null;
  verifiedAt?: Date | null;
  googleResult?: unknown;
  error?: string | null;
  rollbackStatus?: string | null;
  rolledBackBy?: string | null;
  rolledBackAt?: Date | null;
  recommendationRef?: Record<string, unknown> | null;
  clientRequestId?: string | null;
  /**
   * Set only at creation of a PROPOSED change (see openProposalKey); cleared
   * as soon as the status leaves PROPOSED / APPROVED / EXECUTING. Unique per
   * business while set, so two identical open proposals cannot both exist.
   */
  openKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const GbpProfileChangeSchema = new Schema<IGbpProfileChange>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    organizationId: { type: String, default: null },
    locationId: { type: String, required: true },
    kind: { type: String, required: true },
    fields: { type: [String], default: [] },
    sensitive: { type: Boolean, default: false },
    source: { type: String, required: true },
    before: { type: Schema.Types.Mixed, default: null },
    proposed: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    beforeFingerprint: { type: String, required: true },
    afterFingerprint: { type: String, default: null },
    status: {
      type: String,
      enum: ['PROPOSED', 'APPROVED', 'EXECUTING', 'APPLIED', 'VERIFIED', 'FAILED', 'REVERTED', 'BLOCKED', 'CONFLICT', 'UNRESOLVED'],
      default: 'PROPOSED',
      index: true,
    },
    validation: { type: Schema.Types.Mixed, required: true },
    requestedBy: { type: String, required: true },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    executedAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null },
    googleResult: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    rollbackStatus: { type: String, default: null },
    rolledBackBy: { type: String, default: null },
    rolledBackAt: { type: Date, default: null },
    recommendationRef: { type: Schema.Types.Mixed, default: null },
    clientRequestId: { type: String, default: null },
    openKey: { type: String, default: null },
  },
  { timestamps: true },
);

// Release the open-proposal key on every status change that closes the
// proposal, whichever write path makes it: document saves...
GbpProfileChangeSchema.pre('save', function () {
  if (!OPEN_KEY_STATUSES.has(this.status)) this.openKey = null;
});

// ...and update queries that set a status.
GbpProfileChangeSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function () {
  const update = this.getUpdate() as Record<string, any> | null;
  if (!update || Array.isArray(update)) return;
  const status = update.$set?.status ?? update.status;
  if (status === undefined || OPEN_KEY_STATUSES.has(status)) return;
  this.setUpdate({ ...update, $set: { ...(update.$set || {}), openKey: null } });
});

GbpProfileChangeSchema.index({ businessId: 1, createdAt: -1 });
GbpProfileChangeSchema.index(
  { businessId: 1, clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } },
);
// At most one open proposal per business and key. Records without a string
// key (closed proposals, and every record written before this field existed)
// are outside the index, so it builds on existing data. Production builds it
// through scripts/migrate-open-proposal-keys.ts (autoIndex is off there).
GbpProfileChangeSchema.index(
  { businessId: 1, openKey: 1 },
  { name: 'open_proposal_key', unique: true, partialFilterExpression: { openKey: { $type: 'string' } } },
);

const GbpProfileChange: Model<IGbpProfileChange> =
  mongoose.models.GbpProfileChange || mongoose.model<IGbpProfileChange>('GbpProfileChange', GbpProfileChangeSchema);

export default GbpProfileChange;
