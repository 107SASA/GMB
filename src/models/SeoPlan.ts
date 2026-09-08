import mongoose, { Schema, Document } from 'mongoose';
import type { ISeoPlanDraft, IKeywordTableRow } from './Audit';

/**
 * The SEO brain. One versioned document per business per audit cycle.
 *
 *   free report  → SeoPlan v1 (status: active)
 *   pay → intake → merge into a new version
 *   monthly paid re-audit → new version, previous → superseded
 *
 * Content jobs and review replies read `getActiveSeoPlan(businessId)` — the
 * single `status: 'active'` document — for keywords, post themes, the USP
 * line and review-reply must-includes. There is deliberately only ONE brain;
 * do not add a parallel store.
 */

export interface ISeoPlanBaseline {
  overallScore?: number;
  avgRank?: number;
  reviewCount?: number;
  rating?: number;
  completionPct?: number;
  capturedAt: Date;
}

export interface ISeoPlan extends Document {
  businessId: mongoose.Types.ObjectId;
  sourceAuditId?: mongoose.Types.ObjectId;
  version: number;
  status: 'active' | 'superseded';
  horizonDays: number;
  activeFrom: Date;
  activeUntil?: Date;

  primaryKeywords: string[];
  secondaryKeywords: string[];
  cityAreaTerms: string[];
  keywordTable: IKeywordTableRow[];

  suggestedTitle?: string;
  suggestedDescription?: string;
  suggestedServices: string[];
  suggestedCategories: string[];
  suggestedQas: Array<{ q: string; a: string }>;

  uspLine?: string;
  reviewReplyMustInclude: string[];
  postThemes: Array<{ weekday: string; theme: string; keyword: string; postType: string }>;

  keyFinding?: string;
  keywordInsights: string[];
  marketOpportunities: Array<{ keyword: string; potential: string; rationale: string }>;
  competitorLandscape: any[];
  actionPhases: any[];

  /** The full consultant draft as generated, kept verbatim for the
   *  dashboard "SEO Plan" page and the report re-render. */
  draft?: ISeoPlanDraft;

  baseline: ISeoPlanBaseline[];

  /** Owner edits from the intake form / SEO Plan page — never overwritten by
   *  an audit refresh. */
  ownerEdited: boolean;

  /** Set by applyActivePlanToProfile when the title/description drafts were
   *  pushed onto the listing record (locally, or live when writes are on). */
  appliedAt?: Date;
  appliedLive?: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const SeoPlanSchema = new Schema<ISeoPlan>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    sourceAuditId: { type: Schema.Types.ObjectId, ref: 'Audit' },
    version: { type: Number, required: true },
    status: { type: String, enum: ['active', 'superseded'], default: 'active', index: true },
    horizonDays: { type: Number, default: 30 },
    activeFrom: { type: Date, default: Date.now },
    activeUntil: { type: Date },

    primaryKeywords: { type: [String], default: [] },
    secondaryKeywords: { type: [String], default: [] },
    cityAreaTerms: { type: [String], default: [] },
    keywordTable: { type: Schema.Types.Mixed, default: [] },

    suggestedTitle: { type: String },
    suggestedDescription: { type: String },
    suggestedServices: { type: [String], default: [] },
    suggestedCategories: { type: [String], default: [] },
    suggestedQas: { type: Schema.Types.Mixed, default: [] },

    uspLine: { type: String },
    reviewReplyMustInclude: { type: [String], default: [] },
    postThemes: { type: Schema.Types.Mixed, default: [] },

    keyFinding: { type: String },
    keywordInsights: { type: [String], default: [] },
    marketOpportunities: { type: Schema.Types.Mixed, default: [] },
    competitorLandscape: { type: Schema.Types.Mixed, default: [] },
    actionPhases: { type: Schema.Types.Mixed, default: [] },

    draft: { type: Schema.Types.Mixed },
    baseline: { type: Schema.Types.Mixed, default: [] },
    ownerEdited: { type: Boolean, default: false },
    appliedAt: { type: Date },
    appliedLive: { type: Boolean },
  },
  { timestamps: true },
);

// One active plan per business; version is unique per business.
SeoPlanSchema.index({ businessId: 1, status: 1 });
SeoPlanSchema.index({ businessId: 1, version: 1 }, { unique: true });

export default (mongoose.models.SeoPlan as mongoose.Model<ISeoPlan>) ||
  mongoose.model<ISeoPlan>('SeoPlan', SeoPlanSchema);
