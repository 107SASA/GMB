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
  },
  { timestamps: true }
);

export default mongoose.models.BookingAgentConfig ||
  mongoose.model<IBookingAgentConfig>('BookingAgentConfig', BookingAgentConfigSchema);
