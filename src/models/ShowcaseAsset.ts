import mongoose, { Schema, Document } from 'mongoose';

/**
 * A client-submitted photo/video meant for the public GrowwMatics showcase
 * (growwmatics.com/showcase) — "upload a photo/video and it gets posted
 * automatically" (like Grexa), gated by a GrowwMatics superadmin approval
 * step so nothing goes live unreviewed.
 *
 * Deliberately separate from GbpMediaAsset: that model is Google Business
 * Profile media (staged -> published TO GOOGLE). This is unrelated media
 * whose only destination is GrowwMatics' own marketing site.
 *
 * Status lifecycle:
 *   pending  -> just uploaded, awaiting superadmin review. Default.
 *   approved -> live on /showcase (and the public /api/public/showcase feed).
 *               publishedAt is set at the moment of approval.
 *   rejected -> never shown publicly; rejectionReason carries the "why" back
 *               to the business's own dashboard/showcase list.
 */
export type ShowcaseAssetStatus = 'pending' | 'approved' | 'rejected';
export type ShowcaseMediaType = 'photo' | 'video';

export interface IShowcaseAsset extends Document {
  businessId: mongoose.Types.ObjectId;
  uploadedBy?: mongoose.Types.ObjectId;
  mediaType: ShowcaseMediaType;
  url: string;
  caption?: string;
  /**
   * Opt-in: show the business's name alongside the media on the public
   * showcase page. Defaults OFF — a client's brand shouldn't be named on
   * growwmatics.com without them explicitly asking for the credit.
   */
  featureBusinessName: boolean;
  status: ShowcaseAssetStatus;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ShowcaseAssetSchema: Schema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    mediaType: { type: String, enum: ['photo', 'video'], required: true },
    url: { type: String, required: true },
    caption: { type: String, maxlength: 400 },
    featureBusinessName: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

// Public showcase feed + admin queue: newest approved/pending first.
ShowcaseAssetSchema.index({ status: 1, createdAt: -1 });
// Dashboard "my uploads" list.
ShowcaseAssetSchema.index({ businessId: 1, createdAt: -1 });
// Enforces "one video per business, ever" (see /api/showcase/upload POST)
// at the DB level — the route's own exists()-then-create() check is
// TOCTOU-racy on its own (a double-tap or client retry can fire two POSTs
// that both pass the pre-check before either create() lands); this partial
// unique index is what actually makes a second non-rejected video
// impossible, with the route catching the resulting E11000 as the same
// "already submitted" response. A rejected one doesn't count, so the
// business can still submit again after a rejection. Scoped to
// mediaType:'video' only — photo upload is no longer offered going
// forward, but this must never block a business's older, pre-existing
// approved photo(s) from coexisting alongside its one video.
ShowcaseAssetSchema.index(
  { businessId: 1 },
  { unique: true, partialFilterExpression: { mediaType: 'video', status: { $in: ['pending', 'approved'] } } }
);

export default mongoose.models.ShowcaseAsset ||
  mongoose.model<IShowcaseAsset>('ShowcaseAsset', ShowcaseAssetSchema);
