import { randomBytes } from 'crypto';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import ReportShare from '@/models/ReportShare';

/**
 * Public, expiring link to a completed report — the website's full free
 * report page (/free-report/result) with a share token, same as WhatsApp
 * report links. `app: true` adds app=1: no prices / buy buttons (App Store / Play rules).
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
  // The full report — same page and format as the website free report
  // (/free-report/result renders a share token without sign-in).
  return `${base}/free-report/result?auditId=${share.token}${opts.app ? '&app=1' : ''}`;
}
