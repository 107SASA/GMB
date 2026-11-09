import mongoose, { Schema, Document } from 'mongoose';

/**
 * An invoice issued by MULSETU AGROTECH PRIVATE LIMITED (GrowwMatics AI) for
 * one captured Razorpay payment. One per payment (razorpayPaymentId is
 * unique), numbered GM/<financial year>/<serial> with no gaps.
 *
 * The supplier and billed-to details are a SNAPSHOT taken when issued — an
 * invoice never changes after the fact, even if the company or the customer
 * later edits their details. Kept for the statutory retention period, also
 * after the customer deletes their account (services/account/purgePlan.ts).
 */
export interface ICompanyInvoice extends Document {
  invoiceNumber: string;
  financialYear: string; // "2026-27"
  serial: number;
  issuedAt: Date;
  businessId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId | null;
  razorpayPaymentId: string;
  razorpaySubscriptionId?: string | null;
  paymentMethod?: string | null;
  paidAt: Date;
  currency: string;
  /** Amount received, in rupees. */
  amount: number;
  /** GST charged (0 while the supplier is not GST-registered). */
  taxAmount: number;
  description: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  supplier: { legalName: string; brand: string; address: string; cin: string; pan: string; gstin: string | null; email: string; website: string };
  billedTo: { name: string; businessName: string; address: string; email: string | null; phone: string | null };
  emailedAt?: Date | null;
  emailTo?: string | null;
  emailError?: string | null;
}

const CompanyInvoiceSchema = new Schema<ICompanyInvoice>(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    financialYear: { type: String, required: true },
    serial: { type: Number, required: true },
    issuedAt: { type: Date, required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    razorpayPaymentId: { type: String, required: true, unique: true },
    razorpaySubscriptionId: { type: String, default: null },
    paymentMethod: { type: String, default: null },
    paidAt: { type: Date, required: true },
    currency: { type: String, default: 'INR' },
    amount: { type: Number, required: true },
    taxAmount: { type: Number, default: 0 },
    description: { type: String, required: true },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    supplier: { type: Schema.Types.Mixed, required: true },
    billedTo: { type: Schema.Types.Mixed, required: true },
    emailedAt: { type: Date, default: null },
    emailTo: { type: String, default: null },
    emailError: { type: String, default: null },
  },
  { timestamps: true },
);
CompanyInvoiceSchema.index({ financialYear: 1, serial: 1 }, { unique: true });

export default (mongoose.models.CompanyInvoice as mongoose.Model<ICompanyInvoice>) ||
  mongoose.model<ICompanyInvoice>('CompanyInvoice', CompanyInvoiceSchema);
