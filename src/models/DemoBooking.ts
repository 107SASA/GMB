import mongoose from 'mongoose';

const DemoBookingSchema = new mongoose.Schema({
  leadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  name:         { type: String, required: true },
  email:        { type: String, required: true },
  phone:        { type: String, required: true },
  company:      { type: String, required: true },
  businessType: { type: String, required: true },
  location:     { type: String, required: true },
  website:      { type: String },
  monthlyLeads: { type: String },
  challenges:   { type: String },
  date:         { type: String, required: true },
  timeSlot:     { type: String, required: true },
  status:       { type: String, default: 'Pending', enum: ['Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show', 'Rescheduled'] },
}, { timestamps: true });

export default mongoose.models.DemoBooking ||
  mongoose.model('DemoBooking', DemoBookingSchema);