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

  // --- Google Calendar integration (Phase 6) --------------------------------
  // Set once createDemoEvent() succeeds (services/calendar/googleCalendar.ts)
  // — absent for any booking made before this phase, or one whose calendar
  // creation failed and fell back to human handoff (see bookingAgent.ts).
  calendarEventId: { type: String },
  meetingLink:     { type: String },
  salespersonUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  googleEmail:     { type: String },
  calendarId:      { type: String },
  startUtc:        { type: Date },
  endUtc:          { type: Date },
  timezone:        { type: String },
  idempotencyKey:  { type: String },
  // Set only after a confirmation WhatsApp send is claimed. Cleared if that
  // send fails, so a failed delivery is not recorded as sent. A second submit
  // of the same booking sees this and does not send another confirmation.
  whatsappConfirmationSentAt: { type: Date },
  rescheduledFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'DemoBooking' },
  // The 24h-before/1h-before reminder ScheduledActions created alongside
  // this booking, so they can be found and cancelled together on
  // reschedule/cancel without a separate lookup query.
  reminderActionIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'ScheduledAction', default: [] },
}, { timestamps: true });

// SEC-12: book-demo (fileDemoRequest) and the admin Demos view look bookings
// up by leadId, and by (leadId, status:'Pending') for the "needs scheduling"
// group — this collection had no indexes at all.
DemoBookingSchema.index({ leadId: 1, status: 1 });
DemoBookingSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export default mongoose.models.DemoBooking ||
  mongoose.model('DemoBooking', DemoBookingSchema);