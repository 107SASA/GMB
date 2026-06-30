import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IReportShare extends Document {
  auditId:   mongoose.Types.ObjectId;
  token:     string;
  createdBy: string;
  expiresAt: Date;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const ReportShareSchema = new Schema<IReportShare>(
  {
    auditId:   { type: Schema.Types.ObjectId, ref: 'Audit',  required: true, index: true },
    token:     { type: String, required: true, unique: true, index: true },
    createdBy: { type: String, required: true },
    expiresAt: { type: Date,   required: true },
    viewCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const ReportShare: Model<IReportShare> =
  mongoose.models.ReportShare ||
  mongoose.model<IReportShare>('ReportShare', ReportShareSchema);

export default ReportShare;
