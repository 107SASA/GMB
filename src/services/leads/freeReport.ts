import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import { createPendingAuditAndDispatch } from '@/lib/startAudit';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

/**
 * Start (or reuse) the free Google-profile report for a workspace — shared by
 * the website free-report form, free account sign-up and the in-app
 * "Get your free report". Each NEW report spends real money (Places,
 * DataForSEO, AI), so:
 *  - a completed report from the last 30 days is reused (same listing →
 *    rank / keyword / locality / narrative data are cached by Place ID anyway)
 *  - a report still being made is reused, unless it is stuck (> 2 min)
 *  - the platform-wide daily cap (FREE_REPORT_DAILY_CAP, default 500) bounds the bill
 */

const REUSE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STALE_PENDING_MS = 2 * 60 * 1000;

export type FreeReportStart =
  | { ok: true; auditId: string; reused: boolean }
  | { ok: false; code: 'DAILY_CAP'; error: string };

export const FREE_REPORT_DAILY_CAP_ERROR =
  'We are getting a lot of requests right now. Please try again tomorrow, or message us on WhatsApp.';

export async function startOrReuseFreeReport(
  business: any,
  organization: any,
  user: any,
  opts: { reuse?: boolean } = {}
): Promise<FreeReportStart> {
  await dbConnect();
  if (opts.reuse !== false) {
    const existingAudit: any = await Audit.findOne({
      businessId: business._id,
      status: 'COMPLETED',
      createdAt: { $gte: new Date(Date.now() - REUSE_MAX_AGE_MS) },
    })
      .sort({ createdAt: -1 })
      .lean();
    if (existingAudit) return { ok: true, auditId: String(existingAudit._id), reused: true };

    const pendingAudit: any = await Audit.findOne({ businessId: business._id, status: 'PENDING' })
      .sort({ createdAt: -1 })
      .lean();
    if (pendingAudit) {
      // An older PENDING audit is treated as abandoned (e.g. the Inngest job
      // never ran). Fast-mode audits normally complete in ~15–20 s.
      const isStale = Date.now() - new Date(pendingAudit.createdAt).getTime() > STALE_PENDING_MS;
      if (!isStale) return { ok: true, auditId: String(pendingAudit._id), reused: true };
      await Audit.updateOne({ _id: pendingAudit._id }, { $set: { status: 'FAILED' } });
    }
  }

  // Counted just before a report is created, so reused reports (free) don't
  // use up the quota. Resets 00:00 UTC (05:30 IST).
  const dailyCap = Number(process.env.FREE_REPORT_DAILY_CAP) || 500;
  const globalRate = await checkDurableRateLimit('free-report-global', dailyCap, 24 * 60 * 60 * 1000);
  if (!globalRate.allowed && !isQaTestingMode()) {
    console.error(`[free-report] daily cap of ${dailyCap} reached — new free reports are paused until tomorrow (FREE_REPORT_DAILY_CAP).`);
    return { ok: false, code: 'DAILY_CAP', error: FREE_REPORT_DAILY_CAP_ERROR };
  }

  const audit = await createPendingAuditAndDispatch(business, organization, user);
  return { ok: true, auditId: String(audit._id), reused: false };
}
