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
  // Signup identity verification for phone/WhatsApp-OTP-only accounts — see
  // POST /api/onboarding and /api/auth/verify-phone-otp. isEmailVerified stays
  // false for these accounts (never gates anything for them); this is the
  // real gate instead.
  isPhoneVerified?: boolean;
  onboardingCompleted: boolean;

  // Platform context
  organizationId?: mongoose.Types.ObjectId;
  activeBusinessId?: mongoose.Types.ObjectId;
  subscriptionPlan?: string;

  // OTP Fields (Hashed values)
  emailOtpHash?: string;
  emailOtpExpiry?: Date;
  passwordResetOtp?: string;
  passwordResetExpiry?: Date;
  passwordResetAttempts?: number;
  passwordResetLastSentAt?: Date;
  passwordResetTokenHash?: string;
  passwordResetTokenExpiry?: Date;
  failedOtpAttempts: number;
  emailVerifiedAt?: Date;
  phoneVerifiedAt?: Date;

  // Phone + OTP login (WhatsApp-delivered) — separate from the email-based
  // OTP fields above since a user can attempt both flows independently.
  phoneOtpHash?: string;
  phoneOtpExpiry?: Date;

  // Security fields
  failedLoginAttempts: number;
  accountLockedUntil?: Date;
  lastLoginAt?: Date;

  businessIds: mongoose.Types.ObjectId[];

  // Expo push tokens for the mobile app (one per device/install)
  pushTokens: string[];

  notificationPreferences?: INotificationPreferences;

  // Dashboard product tour (see components/tour/) — set the moment the user
  // finishes the last step OR explicitly skips it, whichever comes first.
  // Missing/undefined means "hasn't seen it yet, show it" — matches the
  // freemiumAuditGate pattern below of pre-existing accounts just not having
  // the field rather than needing a backfill.
  productTourCompletedAt?: Date;

  // Soft delete
  isDeleted?: boolean;
  deletedAt?: Date;

  // ADDITIVE — shadow accounts (see src/lib/shadowAccount.ts). Created
  // automatically, passwordless and unverified, the instant a phone-only
  // visitor gets a free report (e.g. /free-report) so the existing
  // audit/billing/dashboard stack (which all assume a real logged-in User)
  // works unmodified. Missing/false on every pre-existing account.
  isShadowAccount?: boolean;
  shadowSource?: string;
  claimedAt?: Date;
  // ADDITIVE — set when the shadow-account owner explicitly dismisses the
  // claim (set email/password) prompt. Phone+OTP login (added after the
  // claim gate existed) is already a durable way back into the account, so
  // this lets proxy.ts stop hard-blocking the dashboard behind claiming once
  // the user has said "not now" — see proxy.ts's needsClaim.
  claimSkipped?: boolean;

  // Freemium onboarding gate — ONLY ever set for brand-new signups (see
  // /api/onboarding). Existing accounts never get this field, and the
  // Subscription/module gating and page-level restriction treat a missing
  // freemiumAuditGate as "full access", so pre-existing users are
  // completely unaffected by this feature.
  freemiumAuditGate?: {
    active: boolean;       // true until the user upgrades to a paid plan
    auditUsed: boolean;    // true once their single free audit report has completed
    auditId?: mongoose.Types.ObjectId; // the one audit they were allowed to generate
  };

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
    isPhoneVerified: { type: Boolean, default: false },
    onboardingCompleted: { type: Boolean, default: false },

    // Platform context
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    activeBusinessId: { type: Schema.Types.ObjectId, ref: 'Business' },
    subscriptionPlan: { type: String, default: 'Free' },

    // OTPs (Stored as hashed values)
    emailOtpHash: { type: String },
    emailOtpExpiry: { type: Date },
    passwordResetOtp: { type: String },
    passwordResetExpiry: { type: Date },
    passwordResetAttempts: { type: Number, default: 0 },
    passwordResetLastSentAt: { type: Date },
    passwordResetTokenHash: { type: String },
    passwordResetTokenExpiry: { type: Date },
    phoneOtpHash: { type: String },
    phoneOtpExpiry: { type: Date },

    // Verification timestamps and rate limiting
    failedOtpAttempts: { type: Number, default: 0 },
    emailVerifiedAt: { type: Date },
    phoneVerifiedAt: { type: Date },

    // Security
    failedLoginAttempts: { type: Number, default: 0 },
    accountLockedUntil: { type: Date },
    lastLoginAt: { type: Date },

    businessIds: [{ type: Schema.Types.ObjectId, ref: 'Business' }],

    pushTokens: [{ type: String }],

    notificationPreferences: { type: NotificationPreferencesSchema, default: () => ({}) },

    productTourCompletedAt: { type: Date },

    // Soft delete
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },

    // ADDITIVE — see isShadowAccount in IUser above.
    isShadowAccount: { type: Boolean, default: false },
    shadowSource: { type: String },
    claimedAt: { type: Date },
    claimSkipped: { type: Boolean, default: false },

    // Freemium onboarding gate — see IUser.freemiumAuditGate above.
    // No top-level default on purpose: only /api/onboarding sets this,
    // explicitly, for brand-new accounts. Existing documents in the
    // database simply won't have this key, and every read site treats
    // "no freemiumAuditGate" as full, unrestricted access.
    freemiumAuditGate: {
      active:    { type: Boolean, default: false },
      auditUsed: { type: Boolean, default: false },
      auditId:   { type: Schema.Types.ObjectId, ref: 'Audit' },
    },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
