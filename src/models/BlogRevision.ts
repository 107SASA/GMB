import mongoose, { Schema, Document } from 'mongoose';

/**
 * A snapshot of a blog post's content, taken every time it is submitted for
 * review and every time a version goes live — the editor's "Version history".
 * Restoring one copies it back into the post's working copy (never straight
 * to the live site).
 */
export interface IBlogRevision extends Document {
  postId: mongoose.Types.ObjectId;
  reason: 'submitted' | 'published' | 'restored';
  snapshot: Record<string, unknown>;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

const BlogRevisionSchema = new Schema<IBlogRevision>(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'BlogPost', required: true },
    reason: { type: String, enum: ['submitted', 'published', 'restored'], required: true },
    snapshot: { type: Schema.Types.Mixed, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

BlogRevisionSchema.index({ postId: 1, createdAt: -1 });

export default (mongoose.models.BlogRevision as mongoose.Model<IBlogRevision>) ||
  mongoose.model<IBlogRevision>('BlogRevision', BlogRevisionSchema);
