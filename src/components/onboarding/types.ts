export interface OnboardingData {
  // Step 1
  fullName: string;
  // Step 2
  email: string;
  password: string;
  confirmPassword: string;
  // Step 3
  companyName: string;
  // Step 4
  businessName: string;
  category: string;
  description: string;
  phone: string;
  address: string;
  area: string;
  city: string;
  state: string;
  country: string;
  website: string;
  // Step 5 (Auto-filled from Step 4)
  googlePlaceId: string;
  gbpUrl: string;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string;
  rating: number;
  totalReviews: number;
  // Step 6
  whatsappBusinessNumber: string;
  metaBusinessProfileUrl: string;
  facebookPageUrl: string;
  instagramUrl: string;
  // Step 7
  aiTone: string;
  aiSalesPrompt: string;
  // Step 8
  selectedPlan: string;
}

export const initialOnboardingData: OnboardingData = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
  companyName: '',
  businessName: '',
  category: '',
  description: '',
  phone: '',
  address: '',
  area: '',
  city: '',
  state: '',
  country: '',
  website: '',
  googlePlaceId: '',
  gbpUrl: '',
  latitude: null,
  longitude: null,
  googleMapsUrl: '',
  rating: 0,
  totalReviews: 0,
  whatsappBusinessNumber: '',
  metaBusinessProfileUrl: '',
  facebookPageUrl: '',
  instagramUrl: '',
  aiTone: 'professional',
  aiSalesPrompt: '',
  selectedPlan: 'growth'
};
