import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * One planned optimization per business per finding, carried across audits
 * (connected baseline → monthly). Status follows the evidence rules in
 * src/services/lifecycle/actions.ts: EXECUTED only with an execution record,
 * VERIFIED only after a later audit re-measured the problem as gone.
 */
export interface IOptimizationAction extends Document {
  businessId: mongoose.Types.ObjectId;
  findingId: string;
  /** Audit that first planned it, and the latest audit that re-measured it. */
  plannedInAuditId: mongoose.Types.ObjectId;
  lastMeasuredAuditId?: mongoose.Types.ObjectId;
  description: string;
  evidence: string;
  evidenceState?: string;
  priority: 'high' | 'medium' | 'low';
  ownerAction: string;
  growwmaticsAction: string | null;
  capability: string | null;
  requiresGbpConnection: boolean;
  measurement: string;
  status: 'PLANNED' | 'READY' | 'EXECUTED' | 'VERIFIED' | 'BLOCKED';
  statusReason?: string;
  plannedAt: Date;
  executedAt?: Date;
  executionResult?: string;
  verifiedAt?: Date;
  verificationResult?: string;
  history: Array<{ at: Date; status: string; reason?: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const OptimizationActionSchema = new Schema<IOptimizationAction>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    findingId: { type: String, required: true },
    plannedInAuditId: { type: Schema.Types.ObjectId, ref: 'Audit', required: true },
    lastMeasuredAuditId: { type: Schema.Types.ObjectId, ref: 'Audit' },
    description: { type: String, required: true },
    evidence: { type: String, default: '' },
    evidenceState: { type: String },
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    ownerAction: { type: String, default: '' },
    growwmaticsAction: { type: String, default: null },
    capability: { type: String, default: null },
    requiresGbpConnection: { type: Boolean, default: false },
    measurement: { type: String, default: '' },
    status: { type: String, enum: ['PLANNED', 'READY', 'EXECUTED', 'VERIFIED', 'BLOCKED'], default: 'PLANNED', index: true },
    statusReason: { type: String },
    plannedAt: { type: Date, required: true },
    executedAt: { type: Date },
    executionResult: { type: String },
    verifiedAt: { type: Date },
    verificationResult: { type: String },
    history: [{ at: Date, status: String, reason: String, _id: false }],
  },
  { timestamps: true },
);

OptimizationActionSchema.index({ businessId: 1, findingId: 1 }, { unique: true });

const OptimizationAction: Model<IOptimizationAction> =
  mongoose.models.OptimizationAction || mongoose.model<IOptimizationAction>('OptimizationAction', OptimizationActionSchema);

export default OptimizationAction;
