import mongoose, { Schema, Document } from 'mongoose';

/**
 * A recipient who replied STOP / UNSUBSCRIBE / CANCEL to a business's WhatsApp
 * messages. Keyed by (business, E.164 number) — NOT by Customer, so deleting
 * and re-adding the customer, or the owner un-ticking "opted out", does not
 * make them messageable again. Checked by every review-request send
 * (lib/reviewSendEligibility.ts and the review-campaign worker).
 *
 * Scope: a STOP on the business's own number suppresses that business; a STOP
 * on the shared Growwmatics number suppresses each business that recently
 * asked this number for a review there (services/messaging/inboundOptOut.ts).
 * There is no lift path yet (no START keyword); removing a row is a manual,
 * audited support action.
 */
export interface IMessagingSuppression extends Document {
  businessId: mongoose.Types.ObjectId;
  /** normalizePhoneE164 of the recipient — the exact address the sender uses. */
  phoneE164: string;
  channel: 'whatsapp';
  /** Which line the STOP arrived on; legacy_customer_flag = backfilled from Customer.optedOut alone. */
  source: 'tenant_number' | 'platform_number' | 'legacy_customer_flag';
  keyword: string;
  /** Provider message id of the first STOP that created the row (audit only). */
  firstMessageId?: string;
  /** Set only on rows written by the one-off backfill (services/messaging/suppressionBackfill.ts). */
  backfill?: { category: string; evidence: string; at: Date };
  createdAt: Date;
  updatedAt: Date;
}

const MessagingSuppressionSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    phoneE164: { type: String, required: true },
    channel: { type: String, enum: ['whatsapp'], default: 'whatsapp', required: true },
    source: { type: String, enum: ['tenant_number', 'platform_number', 'legacy_customer_flag'], required: true },
    keyword: { type: String, required: true },
    firstMessageId: { type: String },
    backfill: { type: new Schema({ category: String, evidence: String, at: Date }, { _id: false }), default: undefined },
  },
  { timestamps: true }
);

// One row per business + number; the upsert on it is the idempotency guarantee.
MessagingSuppressionSchema.index({ businessId: 1, phoneE164: 1, channel: 1 }, { unique: true });

export default mongoose.models.MessagingSuppression ||
  mongoose.model<IMessagingSuppression>('MessagingSuppression', MessagingSuppressionSchema);
