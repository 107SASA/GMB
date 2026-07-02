export interface Business {
  id: string;
  name: string;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  placeId?: string;
  url?: string;
  photos?: any;
}

export interface Audit {
  id: string;
  businessId: string;
  overallScore: number;
  seoScore: number;
  reviewScore: number;
  engagementScore: number;
  completenessScore: number;
  aiSummary?: string;
  createdAt: string;
  business: Business;
  recommendations: Recommendation[];
  reviews?: Review[];
}

export interface Review {
  id: string;
  businessId: string;
  reviewer?: string;
  rating?: number;
  text?: string;
  sentiment?: string;
  createdAt: string;
}

export interface Recommendation {
  id: string;
  auditId: string;
  title: string;
  description: string;
  priority: "High" | "Medium" | "Low";
  impact: "High" | "Medium" | "Low";
  difficulty?: string;
}
