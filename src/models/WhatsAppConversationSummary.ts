import mongoose, { Schema, Document } from 'mongoose';

/**
 * WhatsAppConversationSummary — NEW, ADDITIVE model (Feature 8).
 *
 * Every regeneration inserts a NEW document rather than overwriting the
 * previous one (`isCurrent` flips on the old row) so historical summaries
 * are always preserved and auditable, per spec. Business owners read the
 * latest (`isCurrent: true`) summary; nothing else in the app touches this
 * collection.
 */

export interface IWhatsAppConversationSummary extends Document {
  tenantId: string;
  businessId: mongoose.Types.ObjectId;
  leadId: mongoose.Types.ObjectId;
  threadId?: mongoose.Types.ObjectId;

  customerName?: string;
  interestedServices: string[];
  preferredTimes: string[];
  importantNotes: string[];
  lastInteractionAt: Date;

  version: number;
  isCurrent: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppConversationSummarySchema: Schema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    threadId: { type: Schema.Types.ObjectId, ref: 'ConversationThread', index: true },

    customerName: { type: String },
    interestedServices: { type: [String], default: [] },
    preferredTimes: { type: [String], default: [] },
    importantNotes: { type: [String], default: [] },
    lastInteractionAt: { type: Date, default: Date.now },

    version: { type: Number, required: true },
    isCurrent: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

WhatsAppConversationSummarySchema.index({ leadId: 1, isCurrent: 1 });

export default mongoose.models.WhatsAppConversationSummary ||
  mongoose.model<IWhatsAppConversationSummary>('WhatsAppConversationSummary', WhatsAppConversationSummarySchema);
