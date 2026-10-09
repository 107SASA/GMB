import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * One crawl of a business website, stored once and reused by every stage:
 * free report, AI analysis, keyword discovery, onboarding prefill, the
 * connected audit and later optimization. Keyed by the normalized origin
 * (https://example.com). Every extracted item carries the page URL it came
 * from — these are SOURCE_CLAIMs (what the website says), never verified
 * facts. See src/services/intel/websiteIntelligence.ts.
 */
export interface IWebsiteClaim {
  value: string;
  sourceUrl: string;
}

export interface IWebsiteIntelligence extends Document {
  origin: string;
  crawlDepth?: number;
  requestedUrl: string;
  status: 'complete' | 'partial' | 'failed';
  failureReason?: string;
  pagesCrawled: Array<{ url: string; kind: string; status: 'ok' | 'failed'; title?: string }>;
  homepageHash?: string;
  title?: string;
  metaDescription?: string;
  description?: IWebsiteClaim;
  services: IWebsiteClaim[];
  serviceAreas: IWebsiteClaim[];
  phones: IWebsiteClaim[];
  emails: IWebsiteClaim[];
  socialProfiles: IWebsiteClaim[];
  bookingLinks: IWebsiteClaim[];
  hours: IWebsiteClaim[];
  credentials: IWebsiteClaim[];
  differentiators: IWebsiteClaim[];
  offers?: IWebsiteClaim[];
  brand?: { themeColor?: string; cssColors: string[]; logoUrl?: string; ogImage?: string; images: string[]; sourceUrl: string } | null;
  headings: IWebsiteClaim[];
  schemaTypes: string[];
  keywordsFound: string[];
  /** Public crawl signals used by the FR-4 website audit. Absent on older crawls. */
  fr4Signals?: Record<string, unknown> | null;
  fetchedAt: Date;
  logicVersion: number;
}

const Claim = { value: String, sourceUrl: String };

const WebsiteIntelligenceSchema = new Schema<IWebsiteIntelligence>({
  origin: { type: String, required: true, unique: true, index: true },
  requestedUrl: { type: String },
  status: { type: String, enum: ['complete', 'partial', 'failed'], required: true },
  failureReason: { type: String },
  pagesCrawled: [{ url: String, kind: String, status: String, title: String, _id: false }],
  /** Page budget the stored crawl ran with (a 2-page competitor read never satisfies a 6-page request). */
  crawlDepth: { type: Number },
  homepageHash: { type: String },
  title: { type: String },
  metaDescription: { type: String },
  description: { type: Claim, _id: false },
  services: [{ ...Claim, _id: false }],
  serviceAreas: [{ ...Claim, _id: false }],
  phones: [{ ...Claim, _id: false }],
  emails: [{ ...Claim, _id: false }],
  socialProfiles: [{ ...Claim, _id: false }],
  bookingLinks: [{ ...Claim, _id: false }],
  hours: [{ ...Claim, _id: false }],
  credentials: [{ ...Claim, _id: false }],
  differentiators: [{ ...Claim, _id: false }],
  offers: [{ ...Claim, _id: false }],
  brand: { type: Schema.Types.Mixed },
  headings: [{ ...Claim, _id: false }],
  schemaTypes: [String],
  keywordsFound: [String],
  fr4Signals: { type: Schema.Types.Mixed },
  fetchedAt: { type: Date, default: Date.now },
  logicVersion: { type: Number, default: 1 },
});

const WebsiteIntelligence: Model<IWebsiteIntelligence> =
  mongoose.models.WebsiteIntelligence ||
  mongoose.model<IWebsiteIntelligence>('WebsiteIntelligence', WebsiteIntelligenceSchema);

export default WebsiteIntelligence;
