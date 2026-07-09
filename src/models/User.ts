import mongoose, { Schema, Document } from 'mongoose';

export interface INotificationPreferences {
  newLeadWhatsApp: boolean;
  newLeadEmail: boolean;
  newReviewEmail: boolean;
  criticalReviewWhatsApp: boolean;
  weeklyDigestEmail: boolean;
  campaignCompletedEmail: boolean;
  schedulerLowBufferEmail: boolean;
}

export interface IUser extends Document {
  fullName: string;
  email: string;
  phone: string;
  passwordHash?: string;
  role: 'SUPER_ADMIN' | 'CLIENT';
  companyName?: string;

  // Verification states
  isEmailVerified: boolean;
  onboardingCompleted: boolean;

  // Platform context
  organizationId?: mongoose.Types.ObjectId;
  activeBusinessId?: mongoose.Types.ObjectId;
  subscriptionPlan?: string;

  // OTP Fields (Hashed values)
  emailOtpHash?: string;
  emailOtpExpiry?: Date;
  failedOtpAttempts: number;
  emailVerifiedAt?: Date;

  // Forgot Password flow (all hashed / short-lived)
  passwordResetOtp?: string;
  passwordResetExpiry?: Date;
  passwordResetAttempts: number;
  passwordResetLastSentAt?: Date;
  passwordResetTokenHash?: string;
  passwordResetTokenExpiry?: Date;

  // Security fields
  failedLoginAttempts: number;
  accountLockedUntil?: Date;
  lastLoginAt?: Date;

  businessIds: mongoose.Types.ObjectId[];

  // Expo push tokens for the mobile app (one per device/install)
  pushTokens: string[];

  notificationPreferences?: INotificationPreferences;

  // Soft delete
  isDeleted?: boolean;
  deletedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const NotificationPreferencesSchema = new Schema(
  {
    newLeadWhatsApp: { type: Boolean, default: true },
    newLeadEmail: { type: Boolean, default: true },
    newReviewEmail: { type: Boolean, default: true },
    criticalReviewWhatsApp: { type: Boolean, default: true },
    weeklyDigestEmail: { type: Boolean, default: true },
    campaignCompletedEmail: { type: Boolean, default: true },
    schedulerLowBufferEmail: { type: Boolean, default: true },
  },
  { _id: false }
);

const UserSchema: Schema = new Schema(
  {
    fullName: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    passwordHash: { type: String },

    role: {
      type: String,
      enum: ['SUPER_ADMIN', 'CLIENT'],
      default: 'CLIENT',
    },
    companyName: { type: String },

    isEmailVerified: { type: Boolean, default: false },
    onboardingCompleted: { type: Boolean, default: false },

    // Platform context
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    activeBusinessId: { type: Schema.Types.ObjectId, ref: 'Business' },
    subscriptionPlan: { type: String, default: 'Free' },

    // OTPs (Stored as hashed values)
    emailOtpHash: { type: String },
    emailOtpExpiry: { type: Date },

    // Verification timestamps and rate limiting
    failedOtpAttempts: { type: Number, default: 0 },
    emailVerifiedAt: { type: Date },

    // Forgot Password flow (all hashed / short-lived, never store raw OTP or token)
    passwordResetOtp: { type: String },
    passwordResetExpiry: { type: Date },
    passwordResetAttempts: { type: Number, default: 0 },
    passwordResetLastSentAt: { type: Date },
    passwordResetTokenHash: { type: String },
    passwordResetTokenExpiry: { type: Date },

    // Security
    failedLoginAttempts: { type: Number, default: 0 },
    accountLockedUntil: { type: Date },
    lastLoginAt: { type: Date },

    businessIds: [{ type: Schema.Types.ObjectId, ref: 'Business' }],

    pushTokens: [{ type: String }],

    notificationPreferences: { type: NotificationPreferencesSchema, default: () => ({}) },

    // Soft delete
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
