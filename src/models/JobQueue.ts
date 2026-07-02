import mongoose, { Schema, Document } from 'mongoose';

export interface IJobQueue extends Document {
  jobType: string;
  payload: any;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  retryCount: number;
  nextRetryAt?: Date;
  completedAt?: Date;
  failedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const JobQueueSchema: Schema = new Schema(
  {
    jobType: { type: String, required: true, index: true },
    payload: { type: Schema.Types.Mixed },
    status: { 
      type: String, 
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'], 
      default: 'PENDING',
      index: true
    },
    retryCount: { type: Number, default: 0 },
    nextRetryAt: { type: Date },
    completedAt: { type: Date },
    failedReason: { type: String },
  },
  { timestamps: true }
);

export default mongoose.models.JobQueue || mongoose.model<IJobQueue>('JobQueue', JobQueueSchema);
