import mongoose, { Schema, Document } from 'mongoose';

export interface IBookingMessage {
  role: 'agent' | 'lead';
  text: string;
  at: Date;
}

/** Details the agent collects over the chat before booking the demo. */
export interface IBookingDetails {
  name: string;
  businessName: string;
  businessType: string;
  location: string;
  email: string;
  preferredDate: string;
  preferredTime: string;
  notes: string;
}

/** A real calendar slot offered to the lead, snapshotted at offer time so the deterministic pick step doesn't need a second calendar query to resolve "which slot did they mean." */
export interface IOfferedSlot {
  date: string;   // "YYYY-MM-DD", business-local
  time: string;   // "HH:mm", business-local
  startUtc: Date; // the exact UTC instant getAvailableSlots() computed
}

export interface IBookingConversation extends Document {
  leadPhone: string;          // E.164 with '+'
  phoneKey: string;           // last-10-digits key for robust matching
  leadName: string;
  // 'awaiting_slot_selection' — name/businessName collected, real calendar
  // slots have been offered and the next lead reply is parsed
  // deterministically (a number or a close text match), NOT via the LLM
  // JSON contract — see bookingAgent.ts's pickSlotFromReply().
  status: 'active' | 'awaiting_slot_selection' | 'booked' | 'stopped';
  messages: IBookingMessage[];
  details: IBookingDetails;
  offeredSlots: IOfferedSlot[];
  leadId?: mongoose.Types.ObjectId;
  bookingId?: mongoose.Types.ObjectId;
  bookedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BookingConversationSchema: Schema = new Schema(
  {
    leadPhone: { type: String, required: true, index: true },
    phoneKey: { type: String, index: true },
    leadName: { type: String, default: '' },
    status: { type: String, enum: ['active', 'awaiting_slot_selection', 'booked', 'stopped'], default: 'active', index: true },
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
    details: {
      name: { type: String, default: '' },
      businessName: { type: String, default: '' },
      businessType: { type: String, default: '' },
      location: { type: String, default: '' },
      email: { type: String, default: '' },
      preferredDate: { type: String, default: '' },
      preferredTime: { type: String, default: '' },
      notes: { type: String, default: '' },
    },
    offeredSlots: {
      type: [
        new Schema(
          { date: { type: String, required: true }, time: { type: String, required: true }, startUtc: { type: Date, required: true } },
          { _id: false }
        ),
      ],
      default: [],
    },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    bookingId: { type: Schema.Types.ObjectId, ref: 'DemoBooking' },
    bookedAt: { type: Date },
  },
  { timestamps: true }
);

// One active booking conversation per phone at a time.
BookingConversationSchema.index({ phoneKey: 1, status: 1 });

export default mongoose.models.BookingConversation ||
  mongoose.model<IBookingConversation>('BookingConversation', BookingConversationSchema);
