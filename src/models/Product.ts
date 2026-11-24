import mongoose, { Schema, Document } from 'mongoose';

/**
 * A product the business sells, shown on Google as a product post (photo,
 * price, Order / Shop button). Google has no API for its Products tab, so
 * posts are the automated way products reach the profile — see
 * services/products/productPosts.ts.
 */
export type ProductButton = 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'CALL';

export interface IProduct extends Document {
  businessId: mongoose.Types.ObjectId;
  organizationId?: string;
  name: string;
  category?: string;
  description?: string;
  /** Null = "price on request" (not shown). */
  price?: number | null;
  currency: string;
  imageUrl?: string;
  button: ProductButton;
  /** Order / shop page for the button (CALL needs none). */
  buttonUrl?: string;
  source: 'photo_ai' | 'owner';
  status: 'active' | 'archived';
  lastPostId?: mongoose.Types.ObjectId;
  lastPostedAt?: Date;
  /** Next product post already waiting to publish. */
  scheduledPostAt?: Date;
  postCount: number;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    organizationId: { type: String },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 600 },
    price: { type: Number, default: null },
    currency: { type: String, default: 'INR' },
    imageUrl: { type: String },
    button: { type: String, enum: ['ORDER', 'SHOP', 'LEARN_MORE', 'CALL'], default: 'LEARN_MORE' },
    buttonUrl: { type: String },
    source: { type: String, enum: ['photo_ai', 'owner'], default: 'owner' },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    lastPostId: { type: Schema.Types.ObjectId, ref: 'Post' },
    lastPostedAt: { type: Date },
    scheduledPostAt: { type: Date },
    postCount: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

ProductSchema.index({ businessId: 1, status: 1, lastPostedAt: 1 });

export default (mongoose.models.Product as mongoose.Model<IProduct>) || mongoose.model<IProduct>('Product', ProductSchema);
