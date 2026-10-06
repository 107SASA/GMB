import mongoose, { Schema, Document } from 'mongoose';
import type { BookingAgentConfigShape } from '@/lib/bookingAgentDefaults';

export interface IBookingAgentConfig extends BookingAgentConfigShape, Document {
  key: string; // singleton key: 'default'
  createdAt: Date;
  updatedAt: Date;
}

const BookingAgentConfigSchema: Schema = new Schema(
  {
    key: { type: String, default: 'default', unique: true },
    enabled: { type: Boolean, default: false },
    agentSystemPrompt: { type: String, default: '' },
    confirmationMessage: { type: String, default: '' },
    automatedBookingEnabled: { type: Boolean, default: false },
    demoDurationMinutes: { type: Number, default: 30 },
    timezone: { type: String, default: 'Asia/Kolkata' },
    openingTime: { type: String, default: '10:00' },
    closingTime: { type: String, default: '18:00' },
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
    minAdvanceMinutes: { type: Number, default: 60 },
    maxDaysAhead: { type: Number, default: 14 },
    bufferMinutes: { type: Number, default: 15 },
    assignmentStrategy: { type: String, enum: ['first-available', 'round-robin'], default: 'first-available' },
    reminderLeadMinutes: { type: [Number], default: [1440, 60, 15] },
    roundRobinCursor: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.models.BookingAgentConfig ||
  mongoose.model<IBookingAgentConfig>('BookingAgentConfig', BookingAgentConfigSchema);
