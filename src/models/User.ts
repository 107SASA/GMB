import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  fullName: string;
  email: string;
  phone: string;
  passwordHash?: string; // Optional if you support OAuth later
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
  passwordResetOtp?: string;
  passwordResetExpiry?: Date;
  failedOtpAttempts: number;
  emailVerifiedAt?: Date;
  
  // Security fields
  failedLoginAttempts: number;
  accountLockedUntil?: Date;
  lastLoginAt?: Date;
  
  businessIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    fullName: { type: String, required: true },
    email: { 
      type: String, 
      required: true, 
      unique: true, 
      index: true,
      lowercase: true,
      trim: true
    },
    phone: { 
      type: String, 
      required: true, 
      unique: true, 
      index: true,
      trim: true
    },
    passwordHash: { type: String },
    
    role: { 
      type: String, 
      enum: ['SUPER_ADMIN', 'CLIENT'], 
      default: 'CLIENT' 
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
    passwordResetOtp: { type: String },
    passwordResetExpiry: { type: Date },
    
    // Verification timestamps and rate limiting
    failedOtpAttempts: { type: Number, default: 0 },
    emailVerifiedAt: { type: Date },
    
    // Security
    failedLoginAttempts: { type: Number, default: 0 },
    accountLockedUntil: { type: Date },
    lastLoginAt: { type: Date },
    
    businessIds: [{ type: Schema.Types.ObjectId, ref: 'Business' }],
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
