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

export interface IBookingConversation extends Document {
  leadPhone: string;          // E.164 with '+'
  phoneKey: string;           // last-10-digits key for robust matching
  leadName: string;
  status: 'active' | 'booked' | 'stopped';
  messages: IBookingMessage[];
  details: IBookingDetails;
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
    status: { type: String, enum: ['active', 'booked', 'stopped'], default: 'active', index: true },
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
