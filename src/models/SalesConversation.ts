import mongoose, { Schema, Document } from 'mongoose';

export interface ISalesMessage {
  role: 'agent' | 'lead';
  text: string;
  at: Date;
}

export interface ISalesScores {
  businessName: string;
  rank: number | null;
  profile: number | null;
  seo: number | null;
  review: number | null;
  competitor: string | null;
  missingKeywords: string[];
}

export interface ISalesConversation extends Document {
  businessId: mongoose.Types.ObjectId; // the audited workspace
  auditId?: mongoose.Types.ObjectId;
  leadPhone: string;                    // E.164 with '+'
  phoneKey: string;                     // last-10-digits key for robust matching
  leadName: string;
  status: 'active' | 'subscribed' | 'stopped' | 'completed';
  scores: ISalesScores;
  messages: ISalesMessage[];
  firstSentAt?: Date;
  lastAgentAt?: Date;
  lastLeadReplyAt?: Date;
  followUpsSent: number;
  createdAt: Date;
  updatedAt: Date;
}

const SalesConversationSchema: Schema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    auditId: { type: Schema.Types.ObjectId, ref: 'Audit' },
    leadPhone: { type: String, required: true, index: true },
    phoneKey: { type: String, index: true },
    leadName: { type: String, default: '' },
    status: { type: String, enum: ['active', 'subscribed', 'stopped', 'completed'], default: 'active', index: true },
    scores: {
      businessName: { type: String, default: '' },
      rank: { type: Number, default: null },
      profile: { type: Number, default: null },
      seo: { type: Number, default: null },
      review: { type: Number, default: null },
      competitor: { type: String, default: null },
      missingKeywords: { type: [String], default: [] },
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
    firstSentAt: { type: Date },
    lastAgentAt: { type: Date },
    lastLeadReplyAt: { type: Date },
    followUpsSent: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Only one active sales conversation per phone at a time.
SalesConversationSchema.index({ leadPhone: 1, status: 1 });

export default mongoose.models.SalesConversation ||
  mongoose.model<ISalesConversation>('SalesConversation', SalesConversationSchema);
