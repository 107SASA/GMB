import mongoose, { Schema, Document } from 'mongoose';

export interface IAppointment extends Document {
  leadId: mongoose.Types.ObjectId;
  date: string;
  time: string;
  meetingType: string;
  status: 'Scheduled' | 'Completed' | 'Canceled';
  createdAt: Date;
  updatedAt: Date;
}

const AppointmentSchema: Schema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    meetingType: { type: String, default: 'Discovery Call' },
    status: { type: String, enum: ['Scheduled', 'Completed', 'Canceled'], default: 'Scheduled' }
  },
  { timestamps: true }
);

export default mongoose.models.Appointment || mongoose.model<IAppointment>('Appointment', AppointmentSchema);
