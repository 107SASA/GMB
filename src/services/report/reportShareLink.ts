import { randomBytes } from 'crypto';
import dbConnect from '@/lib/mongodb';
import ReportShare from '@/models/ReportShare';

const SHARE_DAYS = 30;
/** A share with less left than this is replaced, so a link sent today stays usable for a while. */
const MIN_REMAINING_DAYS = 7;

/**
 * Share token for a free report that is sent to a lead over WhatsApp. The
 * person tapping the link is not signed in, and /api/audit/[id] needs a
 * session, so links carry this token instead of the audit id:
 * /free-report/result?auditId=<token> loads it through the public
 * /api/reports/[token]. Reuses a recent share for the same audit.
 */
export async function reportShareToken(auditId: string, createdBy: string): Promise<string> {
  await dbConnect();
  const existing: any = await ReportShare.findOne({
    auditId,
    expiresAt: { $gt: new Date(Date.now() + MIN_REMAINING_DAYS * 86_400_000) },
  }).select('token').lean();
  if (existing?.token) return existing.token;
  const token = randomBytes(24).toString('hex');
  await ReportShare.create({ auditId, token, createdBy, expiresAt: new Date(Date.now() + SHARE_DAYS * 86_400_000) });
  return token;
}
