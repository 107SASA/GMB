import mongoose, { Schema, Model } from 'mongoose';
import dbConnect from '@/lib/mongodb';

/**
 * Fixed-window rate limit stored in MongoDB, so it holds across server
 * instances and restarts — unlike lib/rateLimit.ts, whose in-memory Map is
 * per process. Used where each allowed request spends real money (the free
 * report dispatches paid Google / DataForSEO / Groq calls).
 *
 * One document per key per window; `expiresAt` lets MongoDB's TTL monitor
 * delete old windows. Fails open (allows the request) if the database call
 * itself fails, so an outage of this check can never block the funnel.
 */
interface IRateLimitWindow {
  key: string;
  count: number;
  expiresAt: Date;
}

const RateLimitWindowSchema = new Schema<IRateLimitWindow>({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, expires: 0 },
});

const RateLimitWindow: Model<IRateLimitWindow> =
  mongoose.models.RateLimitWindow ||
  mongoose.model<IRateLimitWindow>('RateLimitWindow', RateLimitWindowSchema);

export async function checkDurableRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    await dbConnect();
    const bucket = Math.floor(Date.now() / windowMs);
    const doc = await RateLimitWindow.findOneAndUpdate(
      { key: `${key}:${bucket}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * windowMs) } },
      { upsert: true, new: true },
    ).lean();
    const count = doc?.count ?? 1;
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch (err: any) {
    console.warn('[durableRateLimit] check failed, allowing request:', err?.message);
    return { allowed: true, remaining: limit };
  }
}
