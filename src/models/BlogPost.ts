import mongoose, { Schema, Document } from 'mongoose';

/**
 * A blog post (growwmatics.com/blog and /hi/blog).
 *
 * Two copies of the content live on every post:
 *  - the WORKING copy (top-level fields) — what the Content Studio editor
 *    reads and writes. Team members only ever change this.
 *  - `live` — the snapshot the public site renders. It is written ONLY when a
 *    Super Admin approves/publishes (services/blog/workflow.ts), so nothing a
 *    team member types can reach the website without approval, and editing a
 *    published post never takes the live version down while it is in review.
 *
 * `status` describes the working copy:
 *   draft             — being written (or edited after publishing)
 *   in_review         — submitted, waiting for a Super Admin
 *   changes_requested — sent back with `reviewNote`
 *   scheduled         — approved; `live` goes public at `live.publishedAt`
 *   published         — working copy == live
 *   archived          — taken off the site (live kept for restore)
 */
export type BlogLanguage = 'en' | 'hi';
export type BlogStatus = 'draft' | 'in_review' | 'changes_requested' | 'scheduled' | 'published' | 'archived';
export type BlogTemplate = 'how_to' | 'listicle' | 'case_study' | 'comparison' | 'local_guide' | 'news' | 'custom';
export type BlogLayout = 'standard' | 'wide' | 'minimal';
export type BlogCtaType = 'free_report' | 'book_demo' | 'custom' | 'none';

export interface IBlogFaq { question: string; answer: string }
export interface IBlogImage { url: string; alt: string; width?: number; height?: number }
export interface IBlogSeo {
  title?: string;
  description?: string;
  focusKeyword?: string;
  ogImageUrl?: string;
  noindex?: boolean;
}
export interface IBlogCta {
  type: BlogCtaType;
  heading?: string;
  text?: string;
  buttonLabel?: string;
  buttonUrl?: string;
}
export interface IBlogDesign {
  layout: BlogLayout;
  showToc: boolean;
  cta: IBlogCta;
}
export interface IBlogTocItem { id: string; text: string; level: 2 | 3 }

/** Fields the editor changes — shared by the working copy and the live snapshot. */
export interface IBlogContent {
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  coverImage?: IBlogImage;
  categoryId?: mongoose.Types.ObjectId | null;
  tags: string[];
  seo: IBlogSeo;
  faqs: IBlogFaq[];
  design: IBlogDesign;
}

export interface IBlogLive extends IBlogContent {
  toc: IBlogTocItem[];
  wordCount: number;
  readingMinutes: number;
  /** When this version became / becomes public (in the future = scheduled). */
  publishedAt: Date;
  /** When this live version was last approved. */
  updatedAt: Date;
}

export interface IBlogPost extends Document, IBlogContent {
  language: BlogLanguage;
  /** Shared by an English post and its Hindi version (hreflang pairing). */
  translationKey: string;
  template: BlogTemplate;
  status: BlogStatus;
  live?: IBlogLive | null;
  /** Earlier live slugs — old URLs 301 to the current one. */
  previousSlugs: string[];
  firstPublishedAt?: Date;
  reviewNote?: string;
  submittedAt?: Date;
  submittedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  reviewedBy?: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  /** Bumped on every save; a save carrying an older value is rejected (two people editing). */
  editVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const FaqSchema = new Schema<IBlogFaq>(
  { question: { type: String, trim: true, maxlength: 300 }, answer: { type: String, trim: true, maxlength: 2000 } },
  { _id: false }
);
const ImageSchema = new Schema<IBlogImage>(
  {
    url: { type: String, trim: true },
    alt: { type: String, trim: true, maxlength: 200, default: '' },
    width: { type: Number },
    height: { type: Number },
  },
  { _id: false }
);
const SeoSchema = new Schema<IBlogSeo>(
  {
    title: { type: String, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 320 },
    focusKeyword: { type: String, trim: true, maxlength: 100 },
    ogImageUrl: { type: String, trim: true },
    noindex: { type: Boolean, default: false },
  },
  { _id: false }
);
const CtaSchema = new Schema<IBlogCta>(
  {
    type: { type: String, enum: ['free_report', 'book_demo', 'custom', 'none'], default: 'free_report' },
    heading: { type: String, trim: true, maxlength: 120 },
    text: { type: String, trim: true, maxlength: 300 },
    buttonLabel: { type: String, trim: true, maxlength: 40 },
    buttonUrl: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);
const DesignSchema = new Schema<IBlogDesign>(
  {
    layout: { type: String, enum: ['standard', 'wide', 'minimal'], default: 'standard' },
    showToc: { type: Boolean, default: true },
    cta: { type: CtaSchema, default: () => ({ type: 'free_report' }) },
  },
  { _id: false }
);

const contentFields = {
  title: { type: String, trim: true, maxlength: 200, default: '' },
  slug: { type: String, trim: true, lowercase: true, maxlength: 120, default: '' },
  excerpt: { type: String, trim: true, maxlength: 400, default: '' },
  contentHtml: { type: String, default: '' },
  coverImage: { type: ImageSchema },
  categoryId: { type: Schema.Types.ObjectId, ref: 'BlogCategory', default: null },
  tags: { type: [String], default: [] },
  seo: { type: SeoSchema, default: () => ({}) },
  faqs: { type: [FaqSchema], default: [] },
  design: { type: DesignSchema, default: () => ({}) },
};

const LiveSchema = new Schema<IBlogLive>(
  {
    ...contentFields,
    toc: {
      type: [new Schema({ id: String, text: String, level: Number }, { _id: false })],
      default: [],
    },
    wordCount: { type: Number, default: 0 },
    readingMinutes: { type: Number, default: 1 },
    publishedAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: false }
);

const BlogPostSchema = new Schema<IBlogPost>(
  {
    ...contentFields,
    language: { type: String, enum: ['en', 'hi'], required: true, default: 'en' },
    translationKey: { type: String, required: true, index: true },
    template: {
      type: String,
      enum: ['how_to', 'listicle', 'case_study', 'comparison', 'local_guide', 'news', 'custom'],
      default: 'custom',
    },
    status: {
      type: String,
      enum: ['draft', 'in_review', 'changes_requested', 'scheduled', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    live: { type: LiveSchema, default: null },
    previousSlugs: { type: [String], default: [] },
    firstPublishedAt: { type: Date },
    reviewNote: { type: String, trim: true, maxlength: 2000 },
    submittedAt: { type: Date },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    editVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Public reads: one post by language + live slug, and listings newest first.
BlogPostSchema.index({ language: 1, 'live.slug': 1 });
BlogPostSchema.index({ language: 1, status: 1, 'live.publishedAt': -1 });
BlogPostSchema.index({ language: 1, previousSlugs: 1 });
BlogPostSchema.index({ updatedAt: -1 });

export default (mongoose.models.BlogPost as mongoose.Model<IBlogPost>) ||
  mongoose.model<IBlogPost>('BlogPost', BlogPostSchema);
