import mongoose, { Schema, Document } from 'mongoose';

export interface IAppointment extends Document {
  leadId: mongoose.Types.ObjectId;
  businessId?: mongoose.Types.ObjectId;
  tenantId?: string;
  date?: string;
  time?: string;
  proposedDate?: Date;
  serviceInterest?: string;
  email?: string;
  meetingType: string;
  source?: string;
  status: 'Pending Confirmation' | 'Scheduled' | 'Completed' | 'Canceled';
  createdAt: Date;
  updatedAt: Date;
}

const AppointmentSchema: Schema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    tenantId: { type: String, index: true },
    date: { type: String },
    time: { type: String },
    proposedDate: { type: Date },
    serviceInterest: { type: String },
    email: { type: String },
    meetingType: { type: String, default: 'Discovery Call' },
    source: { type: String },
    status: {
      type: String,
      enum: ['Pending Confirmation', 'Scheduled', 'Completed', 'Canceled'],
      default: 'Scheduled',
    },
  },
  { timestamps: true }
);

export default mongoose.models.Appointment || mongoose.model<IAppointment>('Appointment', AppointmentSchema);
