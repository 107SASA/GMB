import mongoose, { Schema, Document } from 'mongoose';

/**
 * Audit trail for privileged SUPER_ADMIN actions that act on a customer's
 * data (SEC-5). Frontend hiding a button is not accountability — this records
 * *who* did *what*, *when*, and *to whom*.
 *
 * First use: workspace impersonation (POST /api/admin/impersonate). Add a
 * row here from any future destructive/impersonating admin operation.
 */
export interface IAdminActionLog extends Document {
  adminUserId: mongoose.Types.ObjectId;
  adminEmail?: string;
  action: string; // e.g. 'impersonate.start'
  targetBusinessId?: mongoose.Types.ObjectId;
  targetUserId?: mongoose.Types.ObjectId;
  ip?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const AdminActionLogSchema = new Schema<IAdminActionLog>(
  {
    adminUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    adminEmail: { type: String },
    action: { type: String, required: true, index: true },
    targetBusinessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    targetUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    ip: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Retention: 18 months — admin-action audit trails are compliance-relevant
// and low-volume, so they're kept as long as LeadEvent rather than the
// shorter operational-log windows.
AdminActionLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 548 * 24 * 60 * 60 });

export default (mongoose.models.AdminActionLog as mongoose.Model<IAdminActionLog>) ||
  mongoose.model<IAdminActionLog>('AdminActionLog', AdminActionLogSchema);
