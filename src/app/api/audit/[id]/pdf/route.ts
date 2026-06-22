export const runtime = 'nodejs';
export const maxDuration = 60;

import { requireClient } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import { launchBrowser } from '@/lib/pdf/browser';

function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx < 1) continue;
    const name = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (name) result[name] = value;
  }
  return result;
}

// No extra CSS needed — the print route returns pure HTML, no dashboard chrome.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
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

  // ── Resolve base URL ──────────────────────────────────────────────────────
  // Use NEXT_PUBLIC_APP_URL if set (production), else derive from the request.
  const reqUrl = new URL(request.url);
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    `${reqUrl.protocol}//${reqUrl.host}`;

  // Use the pure-HTML print route — avoids React loading delays and screen-optimized spacing.
  const auditPageUrl = `${baseUrl}/print/audit/${id}`;

  // ── Forward auth cookies so Puppeteer is logged in ────────────────────────
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookies = parseCookies(cookieHeader);

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1.5 });

    // Set session + active business cookies before navigation
    for (const name of ['session', 'activeBusinessId'] as const) {
      if (cookies[name]) {
        await page.setCookie({
          name,
          value: cookies[name],
          domain: reqUrl.hostname,
          path: '/',
          httpOnly: name === 'session',
        });
      }
    }

    // The print route returns server-rendered HTML with no React hydration needed.
    // 'networkidle2' ensures fonts and any static-map images are fetched before capture.
    await page.goto(auditPageUrl, { waitUntil: 'networkidle2', timeout: 30_000 });

    // Small stabilisation pause for web fonts to finish rendering.
    await new Promise(r => setTimeout(r, 600));

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '12mm', bottom: '10mm', left: '12mm' },
    });

    const businessName = (audit.businessName as string) ?? 'Business';
    const safeName = businessName
      .replace(/[^a-z0-9\-_ ]/gi, '')
      .trim()
      .replace(/\s+/g, '-');

    // Uint8Array<ArrayBufferLike> → ArrayBuffer cast: required because this version
    // of puppeteer-core returns a generic Uint8Array that the DOM BodyInit type
    // won't accept directly without the narrower ArrayBuffer form.
    return new Response(pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength) as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}-GMB-Report.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } finally {
    await browser?.close();
  }
}
