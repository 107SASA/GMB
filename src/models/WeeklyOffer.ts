import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * The weekly "Do you have an offer or something to promote?" answer — one
 * per business per week (IST week starting Monday). The question returns
 * every week. Only the owner's own words ever become an offer; nothing is
 * inferred from the website.
 *   YES       → text (+ optional dates / festival / photo) becomes the offer post
 *   NONE      → no offer post this week
 *   DISMISSED → treated as no offer this week; asked again next week
 */
export interface IWeeklyOffer extends Document {
  businessId: mongoose.Types.ObjectId;
  weekKey: string;
  weekStart: Date;
  status: 'YES' | 'NONE' | 'DISMISSED';
  text?: string;
  startsAt?: Date;
  endsAt?: Date;
  festivalName?: string;
  imageId?: string;
  answeredBy?: mongoose.Types.ObjectId;
  /** Post the offer was applied to (execution trace). */
  postId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WeeklyOfferSchema = new Schema<IWeeklyOffer>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    weekKey: { type: String, required: true },
    weekStart: { type: Date, required: true },
    status: { type: String, enum: ['YES', 'NONE', 'DISMISSED'], required: true },
    text: { type: String, maxlength: 600 },
    startsAt: { type: Date },
    endsAt: { type: Date },
    festivalName: { type: String, maxlength: 60 },
    imageId: { type: String },
    answeredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    postId: { type: Schema.Types.ObjectId, ref: 'Post' },
  },
  { timestamps: true },
);

WeeklyOfferSchema.index({ businessId: 1, weekKey: 1 }, { unique: true });

const WeeklyOffer: Model<IWeeklyOffer> =
  mongoose.models.WeeklyOffer || mongoose.model<IWeeklyOffer>('WeeklyOffer', WeeklyOfferSchema);

export default WeeklyOffer;
