import mongoose, { Schema, Document } from 'mongoose';

export interface IFAQ extends Document {
  tenantId: string;
  businessId?: string; // Optional if not linked to a specific business record yet
  question: string;
  answer: string;
  createdAt: Date;
  updatedAt: Date;
}

const FAQSchema: Schema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    businessId: { type: String },
    question: { type: String, required: true },
    answer: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.models.FAQ || mongoose.model<IFAQ>('FAQ', FAQSchema);
