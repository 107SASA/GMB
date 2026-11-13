import { randomBytes } from 'crypto';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import ReportShare from '@/models/ReportShare';

/**
 * Public, expiring link to a completed report (/reports/[token]) — the same
 * share tokens the dashboard's "Share" button creates. `app: true` adds
 * ?app=1: the page then hides its sales block (App Store / Play rules).
 */
export async function reportShareLink(auditIdRaw: unknown, userId: string, opts: { app?: boolean } = {}): Promise<string | null> {
  if (!mongoose.isValidObjectId(String(auditIdRaw))) return null;
  const auditId = new mongoose.Types.ObjectId(String(auditIdRaw));
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) return null;
  await dbConnect();
  let share: any = await ReportShare.findOne({ auditId, expiresAt: { $gt: new Date(Date.now() + 24 * 60 * 60 * 1000) } }).lean();
  if (!share) {
    share = await ReportShare.create({
      auditId,
      token: randomBytes(24).toString('hex'),
      createdBy: userId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  }
  return `${base}/reports/${share.token}${opts.app ? '?app=1' : ''}`;
}
