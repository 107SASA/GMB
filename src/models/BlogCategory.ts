import mongoose, { Schema, Document } from 'mongoose';

/**
 * Blog category — one slug shared by both languages (/blog/category/<slug>
 * and /hi/blog/category/<slug>), with an English and a Hindi name.
 */
export interface IBlogCategory extends Document {
  slug: string;
  name: { en: string; hi?: string };
  description: { en?: string; hi?: string };
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const BlogCategorySchema = new Schema<IBlogCategory>(
  {
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80, unique: true },
    name: {
      en: { type: String, required: true, trim: true, maxlength: 80 },
      hi: { type: String, trim: true, maxlength: 80 },
    },
    description: {
      en: { type: String, trim: true, maxlength: 300 },
      hi: { type: String, trim: true, maxlength: 300 },
    },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default (mongoose.models.BlogCategory as mongoose.Model<IBlogCategory>) ||
  mongoose.model<IBlogCategory>('BlogCategory', BlogCategorySchema);
