import mongoose, { Schema, Document } from 'mongoose';

export interface IAdminInvite extends Document {
  email: string;
  token: string;
  invitedBy: mongoose.Types.ObjectId;
  status: 'pending' | 'accepted' | 'expired';
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdminInviteSchema: Schema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    token: { type: String, required: true, unique: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'expired'],
      default: 'pending',
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export default mongoose.models.AdminInvite ||
  mongoose.model<IAdminInvite>('AdminInvite', AdminInviteSchema);