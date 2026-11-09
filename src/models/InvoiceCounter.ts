import mongoose, { Schema, Document } from 'mongoose';

/** The last invoice serial issued in a financial year ("2026-27"). Incremented atomically. */
export interface IInvoiceCounter extends Document {
  financialYear: string;
  seq: number;
}

const InvoiceCounterSchema = new Schema<IInvoiceCounter>({
  financialYear: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

export default (mongoose.models.InvoiceCounter as mongoose.Model<IInvoiceCounter>) ||
  mongoose.model<IInvoiceCounter>('InvoiceCounter', InvoiceCounterSchema);
