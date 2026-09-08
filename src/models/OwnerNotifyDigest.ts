import mongoose, { Schema, Document } from 'mongoose';

/**
 * A single queued line for the once-a-day owner WhatsApp digest (see
 * ownerWhatsAppDigestCron in services/inngest/functions.ts and
 * services/ownerNotify.ts).
 *
 * Routine automation activity on a workspace — posts published, photos
 * published, AI review replies sent, weekly content batches generated — is
 * too frequent to WhatsApp the owner about one-by-one, so notifyOwner()
 * writes it here instead of sending immediately. The digest cron collects a
 * workspace's unsent rows at ~7pm IST, sends one consolidated message, and
 * stamps `sentAt`. High-value events (new lead, demo booking, critical
 * review, billing, report ready) skip this queue and send immediately.
 *
 * Best-effort like every other notification path in this codebase — a write
 * failure here is logged and swallowed, never thrown back to the workflow
 * that produced the activity.
 */
export interface IOwnerNotifyDigest extends Document {
  businessId: mongoose.Types.ObjectId;
  /** Workspace owner the digest goes to (Business.userId at enqueue time). */
  userId?: mongoose.Types.ObjectId;
  /** Event key — matches the OwnerNotifyEvent union in services/ownerNotify.ts. */
  event: string;
  /** One-line human summary, e.g. `"Post published: Diwali offer"`. */
  text: string;
  /** How many underlying items this line represents (batch sends collapse to one row). */
  count: number;
  /** null until the digest cron includes it in a sent message. */
  sentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const OwnerNotifyDigestSchema = new Schema<IOwnerNotifyDigest>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    event: { type: String, required: true },
    text: { type: String, required: true },
    count: { type: Number, default: 1 },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The digest cron's hot query: unsent rows for a business.
OwnerNotifyDigestSchema.index({ businessId: 1, sentAt: 1 });
// TTL cleanup — a sent (or abandoned) row is useless after a week. Mongo's
// TTL monitor only acts on Date values, so unsent rows (sentAt: null) are
// never expired by this.
OwnerNotifyDigestSchema.index({ sentAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export default (mongoose.models.OwnerNotifyDigest as mongoose.Model<IOwnerNotifyDigest>) ||
  mongoose.model<IOwnerNotifyDigest>('OwnerNotifyDigest', OwnerNotifyDigestSchema);
