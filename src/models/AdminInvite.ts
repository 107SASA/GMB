import mongoose, { Schema, Document } from 'mongoose';

/**
 * SUPER_ADMIN onboarding invite.
 *
 * SECURITY (Sep 2026 — SEC-1): only the SHA-256 hash of the invite token is
 * stored (`tokenHash`), mirroring src/models/LoginLink.ts. The raw token is
 * shown to the inviting admin exactly once, in the POST /api/admin/invites
 * response, and never persisted or returned by the list endpoint. Acceptance
 * (POST /api/admin/invites/accept) hashes the presented token and looks up by
 * hash with a strict string-type guard, so a JSON body value that is an
 * object / Mongo operator (`{"$gt":""}`) can no longer match an arbitrary
 * pending invite and mint an admin account.
 */
export interface IAdminInvite extends Document {
  email: string;
  tokenHash: string;
  invitedBy: mongoose.Types.ObjectId;
  status: 'pending' | 'accepted' | 'expired';
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdminInviteSchema: Schema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'expired'],
      default: 'pending',
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL — an invite is dead 48h after creation (see POST /api/admin/invites);
// keep the row ~30 days past that expiry for the audit trail on
// Admin -> Team Invites, then let Mongo drop it. `expiresAt` is a real Date
// that represents the intended expiration and nothing reads the row after it
// (accept checks status + expiry), so deleting the whole document is safe.
AdminInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.models.AdminInvite ||
  mongoose.model<IAdminInvite>('AdminInvite', AdminInviteSchema);
