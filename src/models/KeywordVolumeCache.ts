import mongoose, { Schema, Document } from 'mongoose';

/**
 * Per-keyword Google Ads search-volume cache.
 *
 * DataForSEO's `keywords_data/google_ads/search_volume/live` costs a flat
 * ~$0.09 per call regardless of keyword count, and monthly volumes barely
 * move. Caching each keyword+location for ~45 days means overlapping keyword
 * sets across businesses (very common — "<category> <city>", "best <x>
 * <city>", neighbourhood phrases) are answered for free.
 *
 * `searchVolume: null` = Google Ads returned no number for that phrase; still
 * cached so we don't re-ask on every audit.
 */

export interface IKeywordVolumeCache extends Document {
  /** `${keyword}::${locationCode}` — lowercased keyword. */
  key: string;
  keyword: string;
  locationCode: number;
  searchVolume: number | null;
  fetchedAt: Date;
}

const KeywordVolumeCacheSchema = new Schema<IKeywordVolumeCache>({
  key: { type: String, required: true, unique: true, index: true },
  keyword: { type: String, required: true },
  locationCode: { type: Number, required: true },
  searchVolume: { type: Number, default: null },
  // TTL: Mongo drops the doc ~45 days after fetchedAt.
  fetchedAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 45 },
});

export default (mongoose.models.KeywordVolumeCache as mongoose.Model<IKeywordVolumeCache>) ||
  mongoose.model<IKeywordVolumeCache>('KeywordVolumeCache', KeywordVolumeCacheSchema);
