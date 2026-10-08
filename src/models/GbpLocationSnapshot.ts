import mongoose, { Schema, Document, Model } from 'mongoose';
import type { ExternalChange, GbpHealth, GbpSnapshotSections } from '@/services/gbp/intelligence/types';

/**
 * GBP Intelligence snapshot (FR-3.2 → FR-3.6) — what Google Business Profile
 * currently says about ONE business's linked location, section by section,
 * plus detected external changes and the derived health.
 *
 * Supplementary and Google-sourced only: Business stays the operational
 * record (owner input), Post stays GrowwMatics-created posts, Review stays the
 * review store. Written only by services/gbp/intelligence/runner.ts; read by
 * the audit (services/audit/auditService.ts) and GET /api/gbp/intelligence.
 * Each section keeps its last successful data when a later fetch fails
 * (see services/gbp/intelligence/types.ts for the section contract).
 */
export interface IGbpLocationSnapshot extends Document {
  businessId: mongoose.Types.ObjectId;
  organizationId?: mongoose.Types.ObjectId;
  accountId?: string | null;
  locationId?: string | null;
  placeId?: string | null;
  source: 'GOOGLE_BUSINESS_PROFILE';
  schemaVersion: number;
  fetchedAt?: Date | null;
  lastSuccessfulSyncAt?: Date | null;
  lastSyncReason?: string | null;
  lastSyncOutcome?: 'SUCCESS' | 'PARTIAL' | 'FAILED' | null;
  sections: GbpSnapshotSections;
  externalChanges: ExternalChange[];
  health: GbpHealth;
  healthState: string;
  /** Google calls made by the last run, by endpoint (observability). */
  lastSyncCalls?: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

const GbpLocationSnapshotSchema = new Schema<IGbpLocationSnapshot>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, unique: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
    accountId: { type: String, default: null },
    locationId: { type: String, default: null },
    placeId: { type: String, default: null },
    source: { type: String, enum: ['GOOGLE_BUSINESS_PROFILE'], default: 'GOOGLE_BUSINESS_PROFILE' },
    schemaVersion: { type: Number, default: 1 },
    fetchedAt: { type: Date, default: null },
    lastSuccessfulSyncAt: { type: Date, default: null },
    lastSyncReason: { type: String, default: null },
    lastSyncOutcome: { type: String, enum: ['SUCCESS', 'PARTIAL', 'FAILED', null], default: null },
    sections: { type: Schema.Types.Mixed, default: {} },
    externalChanges: { type: Schema.Types.Mixed, default: [] },
    health: { type: Schema.Types.Mixed, default: null },
    healthState: { type: String, default: 'UNKNOWN', index: true },
    lastSyncCalls: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false }
);

const GbpLocationSnapshot: Model<IGbpLocationSnapshot> =
  mongoose.models.GbpLocationSnapshot ||
  mongoose.model<IGbpLocationSnapshot>('GbpLocationSnapshot', GbpLocationSnapshotSchema);

export default GbpLocationSnapshot;
