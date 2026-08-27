import mongoose, { Schema, Document } from 'mongoose';

/**
 * A GrowwMatics CLIENT's review of GrowwMatics itself — "how's the service
 * been" — submitted from their own dashboard in one go (name, rating, text,
 * optional photo). NOT a review of the client's own business, and NOT
 * synced from Google — see src/models/Review.ts (Google-synced) and
 * src/models/ReviewRequest.ts (the client's own WhatsApp review campaign)
 * for those, unrelated, flows.
 *
 * Once a GrowwMatics superadmin approves it, it's shown publicly on
 * growwmatics.com/showcase as social proof, alongside client photo/video
 * uploads (see ShowcaseAsset.ts). The business name shown next to it is
 * ALWAYS the submitting workspace's own Business.name, resolved via
 * `businessId` at read time — never free-typed — so it can't be spoofed
 * and stays correct if the business later renames itself.
 *
 * Status lifecycle mirrors ShowcaseAsset: pending -> approved | rejected.
 * Rejected testimonials are never returned by the public feed.
 */
export type TestimonialStatus = 'pending' | 'approved' | 'rejected';

export interface ITestimonial extends Document {
  businessId: mongoose.Types.ObjectId;
  addedBy?: mongoose.Types.ObjectId;
  /** The person at the client business giving the testimonial, e.g. "Priya Sharma, Owner". */
  reviewerName: string;
  rating: number;
  reviewText: string;
  photoUrl?: string;
  status: TestimonialStatus;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TestimonialSchema: Schema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewerName: { type: String, required: true, trim: true, maxlength: 120 },
    rating: { type: Number, required: true, min: 1, max: 5 },
    reviewText: { type: String, required: true, maxlength: 2000 },
    photoUrl: { type: String },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String },
  },
  { timestamps: true }
);

// Public showcase feed + admin queue: newest approved/pending first, across all businesses.
TestimonialSchema.index({ status: 1, createdAt: -1 });
// Dashboard "my submissions" list.
TestimonialSchema.index({ businessId: 1, createdAt: -1 });

export default mongoose.models.Testimonial ||
  mongoose.model<ITestimonial>('Testimonial', TestimonialSchema);
