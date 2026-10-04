import mongoose, { Schema, Document } from 'mongoose';

/**
 * Append-only record of Super Admin nurture-schedule edits.
 * Stores versions and field diffs only — never credentials or message bodies.
 */
export interface INurtureConfigAudit extends Document {
  version: number;
  previousVersion: number;
  actorUserId: string;
  changes: string[];
  createdAt: Date;
}

const NurtureConfigAuditSchema = new Schema(
  {
    version: { type: Number, required: true },
    previousVersion: { type: Number, required: true },
    actorUserId: { type: String, required: true },
    changes: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.models.NurtureConfigAudit ||
  mongoose.model<INurtureConfigAudit>('NurtureConfigAudit', NurtureConfigAuditSchema);
