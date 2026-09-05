export const runtime = 'nodejs';
export const maxDuration = 60;

import { requireAuditAccess } from '@/lib/tenant';
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
  // Single source of truth for "is this caller allowed to view this audit"
  // (owner, org-mate, or SUPER_ADMIN) — no dev-environment bypass; see
  // lib/tenant.ts. Previously this route only allowed owner-or-superadmin,
  // missing the org-member case audit/[id]/route.ts already allowed, so an
  // org-mate could see an audit's data but not download its PDF.
  const { id } = await params;
  const ctx = await requireAuditAccess(id);
  if (!ctx.ok) return ctx.response;
  const audit = ctx.audit;

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

    // Set session + active business cookies before navigation.
    //
    // Pass `url: auditPageUrl` (NOT a hand-computed domain) so Chrome scopes the
    // cookie to exactly the host we're about to navigate to. The previous code
    // used `reqUrl.hostname` — the host of the INCOMING request, which behind a
    // reverse proxy / in a container is often an internal address (127.0.0.1,
    // localhost) that differs from NEXT_PUBLIC_APP_URL. When they differed the
    // cookie wasn't sent, the print page rendered its 401 "Unauthorized" body,
    // and the resulting PDF looked blank.
    // The two setCookie calls don't depend on each other — no need to await
    // them one at a time.
    await Promise.all((['session', 'activeBusinessId'] as const).map((name) => {
      if (!cookies[name]) return undefined;
      return page.setCookie({
        name,
        value: cookies[name],
        url: auditPageUrl,
        httpOnly: name === 'session',
      });
    }));

    // The print route returns server-rendered HTML with no React hydration needed.
    // 'networkidle2' ensures fonts and any static-map images are fetched before capture.
    const response = await page.goto(auditPageUrl, { waitUntil: 'networkidle2', timeout: 30_000 });

    // Never emit a silently-blank PDF: if the print page didn't return 200 (auth
    // failure, audit not found, etc.) surface it as an error instead of shipping
    // an empty document the user can't diagnose.
    if (!response || !response.ok()) {
      throw new Error(`Print page returned HTTP ${response?.status() ?? 'no response'} for ${auditPageUrl}`);
    }

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
