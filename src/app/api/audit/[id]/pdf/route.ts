export const runtime = 'nodejs';
export const maxDuration = 60;

import { requireClient } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import Business from '@/models/Business';
import { buildReportHtml } from '@/lib/pdf/reportHtml';
import { launchBrowser } from '@/lib/pdf/browser';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  await dbConnect();

  const audit = await Audit.findById(id).lean() as any;
  if (!audit) {
    const { NextResponse } = await import('next/server');
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
  }

  const isOwner =
    String(audit.userId) === String(auth.userId) ||
    (auth.user as any)?.role === 'SUPER_ADMIN' ||
    process.env.NODE_ENV !== 'production';

  if (!isOwner) {
    const { NextResponse } = await import('next/server');
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const business = await Business.findById(audit.businessId).lean() as any;

  const html = buildReportHtml({
    audit,
    businessRating: business?.rating,
    coordinates: business?.coordinates,
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
  });

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: 'networkidle2' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '14mm', bottom: '12mm', left: '14mm' },
    });

    const businessName = (audit.businessName as string) ?? 'Business';
    const safeName = businessName.replace(/[^a-z0-9\-_ ]/gi, '').trim().replace(/\s+/g, '-');
    const filename = `${safeName}-GMB-Report.pdf`;

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } finally {
    await browser?.close();
  }
}
