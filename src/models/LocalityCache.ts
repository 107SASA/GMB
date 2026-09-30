import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Reverse-geocoded neighbourhood names around a point (see
 * src/services/audit/localities.ts), keyed by the point rounded to 2 decimal
 * places (~1 km cell). Neighbourhood names around a location effectively
 * never change, so two free reports for businesses in the same ~1 km cell —
 * or a repeat report for the same business — reuse the 8–9 paid Geocoding
 * calls instead of repeating them. Entries expire after 180 days.
 */
export interface ILocalityCache extends Document {
  key: string;
  neighbourhoods: string[];
  resolvedCity: string | null;
  fetchedAt: Date;
}

const LocalityCacheSchema = new Schema<ILocalityCache>({
  key: { type: String, required: true, unique: true },
  neighbourhoods: { type: [String], default: [] },
  resolvedCity: { type: String, default: null },
  fetchedAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
});

const LocalityCache: Model<ILocalityCache> =
  mongoose.models.LocalityCache || mongoose.model<ILocalityCache>('LocalityCache', LocalityCacheSchema);

export default LocalityCache;
