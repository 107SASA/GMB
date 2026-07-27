import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { uploadPublicObject, isStorageConfigured } from '@/lib/storage';
import { uploadLocationPhoto, GBPAuthError, GbpMediaCategory } from '@/lib/gbpClient';
import { gbpWritesEnabled } from '@/lib/gbpSafety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const CATEGORIES: GbpMediaCategory[] = ['PROFILE', 'COVER', 'ADDITIONAL', 'LOGO'];

/**
 * Uploads a media file (logo / cover / additional photo):
 *  1. stores it publicly on DigitalOcean Spaces → public URL,
 *  2. pushes it to the live Google Business Profile (gated behind
 *     GBP_LIVE_WRITES_ENABLED — while off, the file is stored but not sent to Google).
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  if (!ctx.business.googleConnected) {
    return NextResponse.json({ success: false, error: 'Connect your Google Business Profile first.' }, { status: 400 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Media storage is not configured. Set the DO_SPACES_* environment variables.' },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Expected a multipart form upload.' }, { status: 400 });
  }

  const file = form.get('file');
  const category = String(form.get('category') || 'ADDITIONAL').toUpperCase() as GbpMediaCategory;

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'No file uploaded.' }, { status: 400 });
  }
  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ success: false, error: 'Invalid category.' }, { status: 400 });
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ success: false, error: 'Only JPG, PNG or WebP images are allowed.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ success: false, error: 'Image must be 10 MB or smaller.' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const publicUrl = await uploadPublicObject(buffer, file.type, `gbp-media/${ctx.businessId}`);

    // Push to the live profile — gated. Returns liveWriteApplied:false while off.
    const { liveWriteApplied, mediaName } = await uploadLocationPhoto(ctx.businessId, category, publicUrl);

    return NextResponse.json({
      success: true,
      url: publicUrl,
      category,
      liveWriteApplied,
      mediaName,
      ...(liveWriteApplied
        ? {}
        : { note: gbpWritesEnabled() ? undefined : 'Stored — live GBP publishing is currently disabled, so it was not pushed to Google yet.' }),
    });
  } catch (err: any) {
    if (err instanceof GBPAuthError) {
      return NextResponse.json({ success: false, error: 'Google connection expired — please reconnect.' }, { status: 400 });
    }
    console.error('[gbp/media/upload] failed:', err);
    return NextResponse.json({ success: false, error: err.message || 'Upload failed' }, { status: 500 });
  }
}
