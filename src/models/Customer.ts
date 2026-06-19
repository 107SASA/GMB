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
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

// Compound index to prevent duplicate imports per business
CustomerSchema.index({ businessId: 1, phone: 1 }, { unique: true, partialFilterExpression: { phone: { $exists: true, $ne: null } } });
CustomerSchema.index({ businessId: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $exists: true, $ne: null } } });

export default mongoose.models.Customer || mongoose.model<ICustomer>('Customer', CustomerSchema);
