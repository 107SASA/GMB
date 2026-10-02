import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * One phone call to/from a customer business, as reported by an integrated
 * telephony provider (services/telephony). Customer CRM only — the owner
 * decides whether an unknown caller becomes a lead ("Save as lead"), and the
 * CRM's phone performance counts these rows. Only calls the platform actually
 * observed are stored; nothing is inferred.
 */
export type CallDirection = 'inbound' | 'outbound';
export type CallOutcome = 'ringing' | 'answered' | 'missed' | 'ended';
export type CallLeadState = 'pending' | 'existing_lead' | 'saved' | 'dismissed';

export interface ICallEvent extends Document {
  businessId: mongoose.Types.ObjectId;
  provider: string;
  /** Provider's call id (Twilio CallSid) — unique per provider. */
  callId: string;
  direction: CallDirection;
  /** The other party (caller for inbound). */
  phone: string;
  callerName?: string | null;
  outcome: CallOutcome;
  startedAt: Date;
  endedAt?: Date | null;
  durationSec?: number | null;
  recordingUrl?: string | null;
  leadId?: mongoose.Types.ObjectId | null;
  /** pending = unknown caller awaiting Save/Dismiss; existing_lead = matched by phone. */
  leadState: CallLeadState;
  handledBy?: mongoose.Types.ObjectId | null;
  handledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CallEventSchema = new Schema<ICallEvent>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    provider: { type: String, required: true },
    callId: { type: String, required: true },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    phone: { type: String, required: true },
    callerName: { type: String, default: null },
    outcome: { type: String, enum: ['ringing', 'answered', 'missed', 'ended'], default: 'ringing' },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    durationSec: { type: Number, default: null },
    recordingUrl: { type: String, default: null },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    leadState: { type: String, enum: ['pending', 'existing_lead', 'saved', 'dismissed'], default: 'pending', index: true },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    handledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

CallEventSchema.index({ provider: 1, callId: 1 }, { unique: true });
CallEventSchema.index({ businessId: 1, startedAt: -1 });

const CallEvent: Model<ICallEvent> =
  mongoose.models.CallEvent || mongoose.model<ICallEvent>('CallEvent', CallEventSchema);
export default CallEvent;
