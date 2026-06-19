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

  const isOwner =
    String(audit.userId) === String(auth.userId) ||
    (auth.user as any)?.role === 'SUPER_ADMIN' ||
    process.env.NODE_ENV !== 'production';

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
