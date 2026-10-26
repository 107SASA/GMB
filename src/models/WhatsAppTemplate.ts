import mongoose, { Schema, Document } from 'mongoose';

/**
 * An approved WhatsApp template the Super Admin team can send to leads
 * (Settings → WhatsApp templates; Leads & Pipeline → Send WhatsApp). Added
 * from the Super Admin — no server environment change. The name, category,
 * body and approval status are read from Twilio, never typed in by hand.
 */
export interface IWhatsAppTemplate extends Document {
  /** Twilio Content SID, "HX" + 32 hex characters. */
  contentSid: string;
  /** Short name the team picks, shown in the send dialog. */
  label: string;
  /** Twilio's own template name. */
  twilioName?: string;
  category?: string;            // MARKETING | UTILITY | AUTHENTICATION (from Twilio)
  body: string;                 // the text with {{1}}, {{2}} placeholders
  placeholders: number[];
  /** WhatsApp approval as Twilio reports it: approved, pending, rejected, paused, unsubmitted, unknown. */
  approvalStatus: string;
  rejectionReason?: string;
  checkedAt?: Date;
  active: boolean;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppTemplateSchema: Schema = new Schema(
  {
    contentSid: { type: String, required: true, unique: true },
    label: { type: String, required: true, trim: true, maxlength: 60 },
    twilioName: { type: String },
    category: { type: String },
    body: { type: String, default: '' },
    placeholders: [{ type: Number }],
    approvalStatus: { type: String, default: 'unknown' },
    rejectionReason: { type: String },
    checkedAt: { type: Date },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.models.WhatsAppTemplate || mongoose.model<IWhatsAppTemplate>('WhatsAppTemplate', WhatsAppTemplateSchema);
