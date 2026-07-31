import dbConnect from '@/lib/mongodb';
import ReportShare from '@/models/ReportShare';
import Audit from '@/models/Audit';
import { buildReportCardHtml } from '@/lib/pdf/reportCardHtml';
import { extractReportScores } from '@/services/report/reportAgent';

/**
 * Public, unauthenticated print template for the WhatsApp report-card image
 * — mirrors /api/reports/[token]/route.ts's token-only auth (reusing the
 * same ReportShare model unmodified), but returns HTML for Puppeteer to
 * screenshot instead of JSON. No cookie-forwarding needed since this route
 * itself has no session gate.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  await dbConnect();

  const share = await ReportShare.findOne({ token });
  if (!share || share.expiresAt < new Date()) {
    return new Response('Report not available', { status: 404 });
  }

  const audit = await Audit.findById(share.auditId).lean() as any;
  if (!audit || audit.status !== 'COMPLETED') {
    return new Response('Report not available', { status: 404 });
  }

  const scores = extractReportScores(audit, { name: audit.businessName });
  const reviews = audit.auditData?.reviewAnalysis || {};

  const html = buildReportCardHtml({
    businessName: audit.businessName,
    rating: typeof reviews.averageRating === 'number' ? reviews.averageRating : undefined,
    reviewCount: reviews.reviewCount,
    rank: scores.rank,
    profileCompletion: Number(scores.profile) || 0,
    seoScore: Number(scores.seo) || 0,
    reviewScore: Number(scores.review) || 0,
  });

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
