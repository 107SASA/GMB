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
  // 'handed_off' — the lead expressed booking intent mid-nurture and was
  // moved to a BookingConversation instead (see handleActiveSalesConversation
  // in app/api/whatsapp/webhook/route.ts). Distinct from 'stopped' (opted
  // out) and 'completed' so the follow-up drip halts (checks status ===
  // 'active') without reading as a lost/unsubscribed lead in the CRM.
  status: 'active' | 'subscribed' | 'stopped' | 'completed' | 'handed_off';
  /**
   * 'not_required' — this phone has messaged the platform before, so no
   *   separate opt-in is needed.
   * 'pending' — this phone has never messaged first (e.g. submitted via the
   *   public /free-report web form); the real nurture pitch is withheld and
   *   only a "reply YES" consent request has been sent.
   * 'granted' — they replied affirmatively; the real pitch + follow-up drip
   *   may proceed.
   */
  consentStatus: 'not_required' | 'pending' | 'granted';
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
    status: { type: String, enum: ['active', 'subscribed', 'stopped', 'completed', 'handed_off'], default: 'active', index: true },
    consentStatus: { type: String, enum: ['not_required', 'pending', 'granted'], default: 'not_required' },
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
