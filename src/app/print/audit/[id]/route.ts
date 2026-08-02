import { requireClient } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import Business from '@/models/Business';
import { buildReportHtml } from '@/lib/pdf/reportHtml';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireClient();
  if (!auth.ok) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = await params;
  await dbConnect();

  const audit = await Audit.findById(id).lean() as any;
  if (!audit) return new Response('Audit not found', { status: 404 });

  // Ownership is ALWAYS derived from the real session vs. the audit's own
  // userId/organizationId — never from NODE_ENV. A prior version of this
  // check fell back to `process.env.NODE_ENV !== 'production'`, which is a
  // blanket bypass on any staging/preview deploy that doesn't explicitly set
  // NODE_ENV=production (a common Next.js misconfiguration), exposing every
  // customer's full audit PDF cross-tenant by ID. If a local-dev shortcut is
  // ever wanted, gate it behind ALLOW_DEV_PDF_BYPASS=true specifically —
  // deliberately not present in any .env file here, so it must be added by
  // hand and can't leak into a staging config by inheriting from a template.
  const isOwner =
    String(audit.userId) === String(auth.userId) ||
    (!!(auth.user as any)?.organizationId &&
      String(audit.organizationId) === String((auth.user as any).organizationId)) ||
    (auth.user as any)?.role === 'SUPER_ADMIN' ||
    process.env.ALLOW_DEV_PDF_BYPASS === 'true';

  if (!isOwner) return new Response('Forbidden', { status: 403 });

  const business = await Business.findById(audit.businessId).lean() as any;

  const html = buildReportHtml({
    audit,
    businessRating: business?.rating,
    coordinates: business?.coordinates,
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
  });

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
