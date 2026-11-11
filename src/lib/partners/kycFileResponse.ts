import { NextResponse } from 'next/server';

/**
 * Serves a decrypted KYC document. Never cached, never sniffed, and sandboxed
 * so a crafted PDF/image can't run script in our origin.
 */
export function kycFileResponse(doc: { body: Buffer; contentType: string; fileName: string }): NextResponse {
  const name = (doc.fileName || 'document').replace(/[^\w.\- ]+/g, '_');
  return new NextResponse(new Uint8Array(doc.body), {
    headers: {
      'Content-Type': doc.contentType,
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    },
  });
}
