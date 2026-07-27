import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import { listLocationMedia, uploadLocationPhoto, GBPAuthError } from '@/lib/gbpClient';
import { gbpWritesEnabled } from '@/lib/gbpSafety';

export const dynamic = 'force-dynamic';

/**
 * Live Google Business Profile media for the active workspace.
 *  GET  -> list existing photos/logo/cover for display.
 *  POST -> push a photo (logo/cover/additional) to the live profile. The write
 *          is gated behind GBP_LIVE_WRITES_ENABLED; `sourceUrl` must be a public
 *          http(s) URL Google can fetch. Until live writes + media hosting are
 *          set up this returns liveWriteApplied:false.
 */

export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  if (!ctx.business.googleConnected) {
    return NextResponse.json({ success: false, connected: false, error: 'Google Business Profile is not connected.' });
  }

  try {
    const media = await listLocationMedia(ctx.businessId);
    return NextResponse.json({ success: true, connected: true, liveWritesEnabled: gbpWritesEnabled(), media });
  } catch (err: any) {
    if (err instanceof GBPAuthError) {
      return NextResponse.json({ success: false, connected: false, error: 'Google connection expired — please reconnect.' });
    }
    return NextResponse.json({ success: false, connected: true, error: err.message || 'Failed to load media' }, { status: 500 });
  }
}

const postSchema = z.object({
  category: z.enum(['PROFILE', 'COVER', 'ADDITIONAL', 'LOGO']),
  sourceUrl: z.string().url('A public image URL is required.'),
});

export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  if (!ctx.business.googleConnected) {
    return NextResponse.json({ success: false, error: 'Google Business Profile is not connected.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  try {
    const { liveWriteApplied, mediaName } = await uploadLocationPhoto(
      ctx.businessId,
      parsed.data.category,
      parsed.data.sourceUrl,
    );
    return NextResponse.json({
      success: true,
      liveWriteApplied,
      mediaName,
      ...(liveWriteApplied ? {} : { note: 'Live GBP writes are disabled — nothing was pushed to Google.' }),
    });
  } catch (err: any) {
    if (err instanceof GBPAuthError) {
      return NextResponse.json({ success: false, error: 'Google connection expired — please reconnect.' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: err.message || 'Failed to upload media' }, { status: 500 });
  }
}
