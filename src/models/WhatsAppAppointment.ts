import mongoose, { Schema, Document } from 'mongoose';

/**
 * WhatsAppAppointment — NEW, ADDITIVE model.
 *
 * This is intentionally a SEPARATE collection from the existing
 * `Appointment` model (src/models/Appointment.ts), which already serves
 * the CRM "demo booking" workflow and must not be touched. This model is
 * dedicated to real customer service/business appointments booked through
 * the WhatsApp AI Agent (Features 2-6 of the spec): full lifecycle
 * (book/cancel/reschedule), conflict prevention, and an auditable history
 * trail. Nothing outside the WhatsApp module reads or writes this collection.
 */

export interface IWhatsAppAppointmentHistoryEntry {
  action: 'created' | 'confirmed' | 'rescheduled' | 'cancelled' | 'completed';
  previousDate?: string;
  previousTime?: string;
  newDate?: string;
  newTime?: string;
  note?: string;
  at: Date;
}

export interface IWhatsAppAppointment extends Document {
  tenantId: string;
  businessId: mongoose.Types.ObjectId;
  leadId?: mongoose.Types.ObjectId;
  customerId?: mongoose.Types.ObjectId;

  customerName: string;
  phone: string;
  email?: string;
  serviceRequested?: string;

  // Business-local calendar date/time as entered/confirmed, kept as plain
  // strings so they always mean exactly what the business owner sees,
  // independent of server timezone.
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm" 24hr

  // The same instant expressed as an absolute UTC Date, computed from
  // date/time + the business's configured timezone. Used for conflict
  // checks and "is this in the past" comparisons.
  scheduledAt: Date;

  status: 'Pending' | 'Confirmed' | 'Cancelled' | 'Completed';

  source: string;

  cancelledAt?: Date;
  cancelReason?: string;

  history: IWhatsAppAppointmentHistoryEntry[];

  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppAppointmentHistorySchema = new Schema(
  {
    action: {
      type: String,
      enum: ['created', 'confirmed', 'rescheduled', 'cancelled', 'completed'],
      required: true,
    },
    previousDate: { type: String },
    previousTime: { type: String },
    newDate: { type: String },
    newTime: { type: String },
    note: { type: String },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const WhatsAppAppointmentSchema: Schema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },

    customerName: { type: String, required: true },
    phone: { type: String, required: true, index: true },
    email: { type: String },
    serviceRequested: { type: String },

    date: { type: String, required: true },
    time: { type: String, required: true },
    scheduledAt: { type: Date, required: true, index: true },

    status: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Cancelled', 'Completed'],
      default: 'Pending',
      index: true,
    },

    source: { type: String, default: 'WhatsApp AI Agent' },

    cancelledAt: { type: Date },
    cancelReason: { type: String },

    history: { type: [WhatsAppAppointmentHistorySchema], default: [] },
  },
  { timestamps: true }
);

// Prevent double-booking the exact same business/date/time while the slot
// is still active (Pending or Confirmed). Cancelled/Completed appointments
// are excluded so a freed-up or historical slot can be reused.
WhatsAppAppointmentSchema.index(
  { businessId: 1, date: 1, time: 1, status: 1 },
  { name: 'business_slot_lookup' }
);

export default mongoose.models.WhatsAppAppointment ||
  mongoose.model<IWhatsAppAppointment>('WhatsAppAppointment', WhatsAppAppointmentSchema);
