import mongoose, { Schema, Document } from 'mongoose';

/**
 * Short-lived staging record for the OAuth callback's multi-location picker
 * (see src/app/api/auth/google/callback/route.ts). When a connected Google
 * account manages more than one GBP location and none confidently matches
 * the workspace's own googlePlaceId, the callback can't safely auto-select
 * one (that was the root cause of every workspace under an account
 * inheriting whichever location connected first/last). Instead it stages the
 * exchanged tokens + candidate list here, keyed by an opaque reference held
 * in a short-lived cookie (mirrors the gbp_oauth_state cookie pattern already
 * used earlier in the same flow), and redirects to a picker page.
 *
 * Tokens are encrypted at rest with the same encrypt()/decrypt() (AES-256-GCM,
 * GOOGLE_TOKEN_SECRET) used for GBPToken — this is transient, not permanent,
 * storage, but it holds the same class of secret.
 *
 * TTL-indexed: auto-deleted 15 minutes after creation whether or not the user
 * completes the picker, so an abandoned OAuth flow never leaves live Google
 * credentials sitting in the database.
 */
export interface IPendingGbpConnection extends Document {
  tokenHash: string;
  businessId: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  googleAccountId: string;
  googleEmail: string;
  accessToken: string; // encrypted
  refreshToken: string; // encrypted
  expiresAt: Date; // Google access-token expiry
  accountId: string; // "accounts/{x}"
  scopes: string[];
  candidateLocations: Array<{
    locationId: string; // "locations/{y}"
    title: string;
    address: string;
    placeId?: string;
  }>;
  createdAt: Date;
}

const PendingGbpConnectionSchema = new Schema<IPendingGbpConnection>(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    googleAccountId: { type: String, required: true },
    googleEmail: { type: String, required: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    accountId: { type: String, required: true },
    scopes: [{ type: String }],
    candidateLocations: [
      {
        _id: false,
        locationId: { type: String, required: true },
        title: { type: String, default: '' },
        address: { type: String, default: '' },
        placeId: { type: String },
      },
    ],
    createdAt: { type: Date, default: Date.now, expires: 15 * 60 }, // TTL: 15 minutes
  },
  { timestamps: { createdAt: false, updatedAt: false } }
);

export default mongoose.models.PendingGbpConnection ||
  mongoose.model<IPendingGbpConnection>('PendingGbpConnection', PendingGbpConnectionSchema);
