import mongoose from 'mongoose';

const DemoBookingSchema = new mongoose.Schema({
  leadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  name:         { type: String, required: true },
  // email/company/businessType/location are collected by the old form but are
  // optional for WhatsApp bookings, where the agent may not gather them all.
  email:        { type: String },
  phone:        { type: String, required: true },
  company:      { type: String },
  businessType: { type: String },
  location:     { type: String },
  website:      { type: String },
  monthlyLeads: { type: String },
  challenges:   { type: String },
  date:         { type: String, required: true },
  timeSlot:     { type: String, required: true },
  status:       { type: String, default: 'Pending', enum: ['Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show', 'Rescheduled'] },
  // How the booking came in — website form vs the WhatsApp booking agent.
  channel:      { type: String, default: 'form', enum: ['form', 'whatsapp'] },
}, { timestamps: true });

export default mongoose.models.DemoBooking ||
  mongoose.model('DemoBooking', DemoBookingSchema);