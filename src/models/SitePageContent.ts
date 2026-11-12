import mongoose, { Schema, Document } from 'mongoose';

/**
 * Website page content edited in the Content Studio "Website pages" area:
 * Google search listing (title/description), social share preview, hide-from-
 * Google switch and — for pages that have them — the FAQ list.
 *
 * Same approval model as BlogPost: `draft` is what the team edits; `live` is
 * what the website uses, written only when a Super Admin approves. A page with
 * no `live` (or an empty field in it) falls back to the copy in code
 * (src/lib/cms/pages.ts), so an empty CMS never changes the site.
 */
export interface ISitePageFields {
  seoTitle?: string;
  seoDescription?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImageUrl?: string;
  noindex?: boolean;
  /** Only for pages whose registry entry has `faqs: true`. Empty = use the built-in list. */
  faqs?: { question: string; answer: string }[];
}

export interface ISitePageContent extends Document {
  /** Registry key from src/lib/cms/pages.ts, e.g. 'home', 'pricing'. */
  pageKey: string;
  draft: ISitePageFields;
  live?: ISitePageFields | null;
  status: 'draft' | 'in_review' | 'changes_requested' | 'published';
  reviewNote?: string;
  submittedAt?: Date;
  submittedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  reviewedBy?: mongoose.Types.ObjectId;
  liveUpdatedAt?: Date;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FieldsSchema = new Schema<ISitePageFields>(
  {
    seoTitle: { type: String, trim: true, maxlength: 120 },
    seoDescription: { type: String, trim: true, maxlength: 320 },
    ogTitle: { type: String, trim: true, maxlength: 120 },
    ogDescription: { type: String, trim: true, maxlength: 320 },
    ogImageUrl: { type: String, trim: true, maxlength: 1000 },
    noindex: { type: Boolean, default: false },
    faqs: {
      type: [
        new Schema(
          { question: { type: String, trim: true, maxlength: 300 }, answer: { type: String, trim: true, maxlength: 2000 } },
          { _id: false }
        ),
      ],
      default: undefined,
    },
  },
  { _id: false }
);

const SitePageContentSchema = new Schema<ISitePageContent>(
  {
    pageKey: { type: String, required: true, unique: true, trim: true },
    draft: { type: FieldsSchema, default: () => ({}) },
    live: { type: FieldsSchema, default: null },
    status: { type: String, enum: ['draft', 'in_review', 'changes_requested', 'published'], default: 'draft', index: true },
    reviewNote: { type: String, trim: true, maxlength: 2000 },
    submittedAt: { type: Date },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    liveUpdatedAt: { type: Date },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default (mongoose.models.SitePageContent as mongoose.Model<ISitePageContent>) ||
  mongoose.model<ISitePageContent>('SitePageContent', SitePageContentSchema);
