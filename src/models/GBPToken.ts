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
  },
  { timestamps: true }
);

export default mongoose.models.GBPToken ||
  mongoose.model<IGBPToken>('GBPToken', GBPTokenSchema);
