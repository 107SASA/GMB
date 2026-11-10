import mongoose, { Schema, Model } from 'mongoose';
import dbConnect from '@/lib/mongodb';

/**
 * Monthly spend ceiling for the keyword system's paid calls, per business
 * (docs/KEYWORD_SYSTEM_PLAN.md §7a). Default $1.20 (~₹100); override with
 * KEYWORD_BUDGET_USD_PER_MONTH. Spend is recorded from paid calls actually
 * made (cache hits cost nothing). Fails open: if the database check fails
 * the full budget is assumed, so the audit is never blocked by this guard.
 */

interface IKeywordBudget {
  key: string;       // `${businessId}:${YYYY-MM}`
  spentUsd: number;
  expiresAt: Date;   // TTL — kept ~2 months for debugging
}

const KeywordBudgetSchema = new Schema<IKeywordBudget>({
  key: { type: String, required: true, unique: true },
  spentUsd: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, expires: 0 },
});

const KeywordBudget: Model<IKeywordBudget> =
  mongoose.models.KeywordBudget || mongoose.model<IKeywordBudget>('KeywordBudget', KeywordBudgetSchema);

export function monthlyKeywordBudgetUsd(): number {
  const n = Number(process.env.KEYWORD_BUDGET_USD_PER_MONTH);
  return Number.isFinite(n) && n > 0 ? n : 1.2;
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export async function keywordBudgetRemaining(businessId: string, now = new Date()): Promise<number> {
  const ceiling = monthlyKeywordBudgetUsd();
  try {
    await dbConnect();
    const doc = await KeywordBudget.findOne({ key: `${businessId}:${monthKey(now)}` }).lean();
    return Math.max(0, ceiling - (doc?.spentUsd ?? 0));
  } catch (err: any) {
    console.warn('[keywordBudget] read failed, assuming full budget:', err?.message);
    return ceiling;
  }
}

export async function recordKeywordSpend(businessId: string, usd: number, now = new Date()): Promise<void> {
  if (!(usd > 0)) return;
  try {
    await dbConnect();
    const expiresAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
    await KeywordBudget.updateOne(
      { key: `${businessId}:${monthKey(now)}` },
      { $inc: { spentUsd: Math.round(usd * 10_000) / 10_000 }, $setOnInsert: { expiresAt } },
      { upsert: true },
    );
  } catch (err: any) {
    console.warn('[keywordBudget] spend not recorded:', err?.message);
  }
}
