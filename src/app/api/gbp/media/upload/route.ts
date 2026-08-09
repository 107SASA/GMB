import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { uploadPublicObject, isStorageConfigured } from '@/lib/storage';
import { createOrReplaceStagedAsset } from '@/lib/gbpMediaService';
import { GbpMediaCategory } from '@/lib/gbpClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const CATEGORIES: GbpMediaCategory[] = ['PROFILE', 'COVER', 'ADDITIONAL', 'LOGO'];

/**
 * Uploads a media file and STAGES it (logo / cover / additional photo) — it
 * does not push to Google here. Publishing is a separate, explicit step
 * (POST /api/gbp/media/[id]/publish) so every upload gets a real preview/
 * review moment before it goes live, rather than firing live the instant the
 * gate happens to be on. See gbpMediaService.ts for the staging logic.
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

    const asset = await createOrReplaceStagedAsset({
      businessId: ctx.businessId,
      organizationId: ctx.organizationId,
      uploadedBy: ctx.userId,
      category,
      url: publicUrl,
    });

    return NextResponse.json({ success: true, asset });
  } catch (err: any) {
    console.error('[gbp/media/upload] failed:', err);
    return NextResponse.json({ success: false, error: err.message || 'Upload failed' }, { status: 500 });
  }
}
