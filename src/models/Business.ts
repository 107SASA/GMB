import mongoose, { Schema, Document } from 'mongoose';

export interface IBusiness extends Document {
  name: string;
  category: string;
  description?: string;
  address: string;
  area?: string;
  city?: string;
  state?: string;
  country?: string;
  googleMapsUrl?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  services?: string;
  offers?: string;
  tone?: string;
  phone?: string;
  website?: string;
  rating: number;
  reviewCount: number;
  placeId?: string;
  serpApiDataId?: string;
  photoCount?: number;
  hasHours?: boolean;
  googlePlaceId?: string;
  googleLocationId?: string;
  userDefinedCategory?: string;
  googleAccountId?: string;
  googleTypes?: string[];
  googleConnected: boolean;
  keywords: string[];
  competitors: mongoose.Types.ObjectId[];
  organizationId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  integrations: {
    whatsappNumber?: string;
  };
  metaBusinessProfileUrl?: string;
  facebookPageUrl?: string;
  instagramUrl?: string;
  whatsappConfig: {
    provider: string;
    businessPhone?: string;
    metaProfileUrl?: string;
    isConnected: boolean;
  };
  aiSettings: {
    tone: string;
    salesPrompt?: string;
    replyStyle?: string;
    leadQualificationBehavior?: string;
  };
  reviewAutomationSettings: {
    enabled: boolean;
    reminderDays: number;
    messageTemplate?: string;
  };
  kanbanColumns: string[];
  onboardingCompleted: boolean;
  faqs?: Array<{ question: string; answer: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const BusinessSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    category: { type: String, required: true },
    description: { type: String },
    address: { type: String, required: true },
    area: { type: String },
    city: { type: String },
    state: { type: String },
    country: { type: String },
    googleMapsUrl: { type: String },
    coordinates: {
      lat: { type: Number },
      lng: { type: Number }
    },
    services: { type: String },
    offers: { type: String },
    tone: { type: String, default: 'professional' },
    phone: { type: String },
    website: { type: String },
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    placeId: { type: String, unique: true, sparse: true },
    serpApiDataId: { type: String },
    photoCount: { type: Number },
    hasHours: { type: Boolean },
    googlePlaceId: { type: String },
    googleLocationId: { type: String },
    userDefinedCategory: { type: String },
    googleAccountId: { type: String },
    googleTypes: [{ type: String }],
    googleConnected: { type: Boolean, default: false },
    keywords: [{ type: String }],
    competitors: [{ type: Schema.Types.ObjectId, ref: 'Business' }],
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    integrations: {
      whatsappNumber: { type: String }
    },
    metaBusinessProfileUrl: { type: String },
    facebookPageUrl: { type: String },
    instagramUrl: { type: String },
    whatsappConfig: {
      provider: { type: String, default: 'meta' },
      businessPhone: { type: String },
      metaProfileUrl: { type: String },
      isConnected: { type: Boolean, default: false }
    },
    aiSettings: {
      tone: { type: String, default: 'professional' },
      salesPrompt: { type: String },
      replyStyle: { type: String },
      leadQualificationBehavior: { type: String }
    },
    reviewAutomationSettings: {
      enabled: { type: Boolean, default: false },
      reminderDays: { type: Number, default: 3 },
      messageTemplate: { type: String }
    },
    kanbanColumns: [{ type: String }],
    onboardingCompleted: { type: Boolean, default: false },
    faqs: [{ question: { type: String }, answer: { type: String } }],
  },
  { timestamps: true }
);

export default mongoose.models.Business || mongoose.model<IBusiness>('Business', BusinessSchema);