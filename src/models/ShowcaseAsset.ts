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

export default mongoose.models.ShowcaseAsset ||
  mongoose.model<IShowcaseAsset>('ShowcaseAsset', ShowcaseAssetSchema);
