import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomer extends Document {
  tenantId: string;
  businessId: mongoose.Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  service?: string;
  serviceDate?: Date;
  tags: string[];
  notes?: string;
  optedOut: boolean;
  reviewStatus: 'Pending' | 'Requested' | 'Completed' | 'Failed';
  totalMessagesSent: number;
  lastMessageAt?: Date;
  metadata?: Record<string, any>;
  // ADDITIVE — used in read-only mode by the WhatsApp AI Agent for
  // personalization (Feature 9). Defaults to 0, never written by any
  // existing module, so nothing outside WhatsApp is affected.
  totalSpend?: number;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    name: { type: String, required: true },
    phone: { type: String }, // Stored as standard +1234567890 if available
    email: { type: String },
    service: { type: String },
    serviceDate: { type: Date },
    tags: [{ type: String }],
    notes: { type: String },
    optedOut: { type: Boolean, default: false },
    reviewStatus: { 
      type: String, 
      enum: ['Pending', 'Requested', 'Completed', 'Failed'], 
      default: 'Pending' 
    },
    totalMessagesSent: { type: Number, default: 0 },
    lastMessageAt: { type: Date },
    metadata: { type: Schema.Types.Mixed },
    totalSpend: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Compound indexes to prevent duplicate imports per business. The partial
// filter uses `$type: 'string'` — NOT `$ne: null`, which MongoDB rejects in a
// partialFilterExpression ("Expression not supported in partial index: $not"),
// so these unique constraints silently never built before. `$type: 'string'`
// indexes exactly the rows that have a real phone/email and skips the rest.
CustomerSchema.index({ businessId: 1, phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
CustomerSchema.index({ businessId: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });

export default mongoose.models.Customer || mongoose.model<ICustomer>('Customer', CustomerSchema);
