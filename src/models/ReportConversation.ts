import mongoose, { Schema, Document } from 'mongoose';

export interface IReportMessage {
  role: 'agent' | 'lead';
  text: string;
  at: Date;
}

/** A single Google location the visitor could pick during OAuth, staged until
 *  they confirm which one is theirs (see pendingGoogleAuth below). */
export interface ICandidateLocation {
  locationId: string; // "accounts/{x}/locations/{y}"
  placeId?: string;
  title: string;
  address?: string;
}

/**
 * Holds the Google OAuth result between "authenticated with Google" and
 * "Business exists to attach a GBPToken to" — only needed when the account
 * manages more than one GBP location and the visitor must pick which one is
 * theirs. Cleared once provisioning finalizes.
 */
export interface IPendingGoogleAuth {
  accessToken: string;  // encrypted, see src/lib/crypto.ts
  refreshToken: string; // encrypted
  expiresAt: Date;
  scopes: string[];
  googleAccountId: string;
  googleEmail: string;
  accountId: string; // "accounts/{id}"
  candidateLocations: ICandidateLocation[];
}

export interface IReportConversation extends Document {
  leadPhone: string; // E.164 with '+'
  phoneKey: string;  // last-10-digits key for robust matching
  leadName: string;
  status: 'awaiting_connection' | 'connected' | 'report_sent' | 'stopped';
  messages: IReportMessage[];
  pendingGoogleAuth?: IPendingGoogleAuth;
  businessId?: mongoose.Types.ObjectId;
  auditId?: mongoose.Types.ObjectId;
  connectedAt?: Date;
  reportSentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CandidateLocationSchema = new Schema<ICandidateLocation>(
  {
    locationId: { type: String, required: true },
    placeId: { type: String },
    title: { type: String, required: true },
    address: { type: String },
  },
  { _id: false }
);

const PendingGoogleAuthSchema = new Schema<IPendingGoogleAuth>(
  {
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    scopes: [{ type: String }],
    googleAccountId: { type: String, required: true },
    googleEmail: { type: String, required: true },
    accountId: { type: String, required: true },
    candidateLocations: { type: [CandidateLocationSchema], default: [] },
  },
  { _id: false }
);

const ReportConversationSchema: Schema = new Schema(
  {
    leadPhone: { type: String, required: true, index: true },
    phoneKey: { type: String, index: true },
    leadName: { type: String, default: '' },
    status: {
      type: String,
      enum: ['awaiting_connection', 'connected', 'report_sent', 'stopped'],
      default: 'awaiting_connection',
      index: true,
    },
    messages: {
      type: [
        new Schema(
          {
            role: { type: String, enum: ['agent', 'lead'], required: true },
            text: { type: String, required: true },
            at: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    pendingGoogleAuth: { type: PendingGoogleAuthSchema, default: undefined },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business' },
    auditId: { type: Schema.Types.ObjectId, ref: 'Audit' },
    connectedAt: { type: Date },
    reportSentAt: { type: Date },
  },
  { timestamps: true }
);

// One active report conversation per phone at a time.
ReportConversationSchema.index({ phoneKey: 1, status: 1 });

export default mongoose.models.ReportConversation ||
  mongoose.model<IReportConversation>('ReportConversation', ReportConversationSchema);
