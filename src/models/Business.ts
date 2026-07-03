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
  isDeleted?: boolean;
  // ADDITIVE — WhatsApp AI Agent booking configuration (Feature 1).
  // Opt-in only: bookingEnabled defaults to false so existing businesses
  // are completely unaffected until they explicitly configure this.
  whatsappBookingSettings?: {
    bookingEnabled: boolean;
    timezone: string;
    workingDays: {
      monday: boolean;
      tuesday: boolean;
      wednesday: boolean;
      thursday: boolean;
      friday: boolean;
      saturday: boolean;
      sunday: boolean;
    };
    openingTime: string; // 24hr "HH:mm"
    closingTime: string; // 24hr "HH:mm"
    slotDurationMinutes: number;
  };
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
    isDeleted: { type: Boolean, default: false },
    // ADDITIVE — see whatsappBookingSettings in IBusiness above. Not required,
    // no default object is forced onto existing documents; the WhatsApp
    // appointment agent treats a missing/disabled config as "booking off".
    whatsappBookingSettings: {
      bookingEnabled: { type: Boolean, default: false },
      timezone: { type: String, default: 'Asia/Kolkata' },
      workingDays: {
        monday: { type: Boolean, default: true },
        tuesday: { type: Boolean, default: true },
        wednesday: { type: Boolean, default: true },
        thursday: { type: Boolean, default: true },
        friday: { type: Boolean, default: true },
        saturday: { type: Boolean, default: true },
        sunday: { type: Boolean, default: false },
      },
      openingTime: { type: String, default: '09:00' },
      closingTime: { type: String, default: '18:00' },
      slotDurationMinutes: { type: Number, default: 30 },
    },
  },
  { timestamps: true }
);

export default mongoose.models.Business || mongoose.model<IBusiness>('Business', BusinessSchema);