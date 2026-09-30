import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Audit trail of account hard-purges (accountHardPurgeCron). Holds ONLY ids,
 * counts and error messages — never the purged personal data — and has no
 * TTL: it is the record that an erasure happened and what it covered.
 * Dry runs are not written here (they write nothing at all).
 */
export interface IAccountPurgeLog extends Document {
  userId: mongoose.Types.ObjectId;
  businessIds: mongoose.Types.ObjectId[];
  deletedAt?: Date;
  startedAt: Date;
  finishedAt?: Date;
  /** Documents deleted / anonymized per collection. */
  counts: Record<string, number>;
  storageObjectsDeleted: number;
  errorMessages: string[];
  complete: boolean;
}

const AccountPurgeLogSchema = new Schema<IAccountPurgeLog>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    businessIds: [{ type: Schema.Types.ObjectId }],
    deletedAt: { type: Date },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    counts: { type: Schema.Types.Mixed, default: {} },
    storageObjectsDeleted: { type: Number, default: 0 },
    errorMessages: [{ type: String }],
    complete: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const AccountPurgeLog: Model<IAccountPurgeLog> =
  mongoose.models.AccountPurgeLog || mongoose.model<IAccountPurgeLog>('AccountPurgeLog', AccountPurgeLogSchema);
export default AccountPurgeLog;
