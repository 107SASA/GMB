import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { uploadPublicObject, isStorageConfigured } from '@/lib/storage';
import { createOrReplaceStagedAsset } from '@/lib/gbpMediaService';
import { photoLocationFromForm, prepareGalleryMedia } from '@/lib/mediaUpload';
import { getVerifiedBusinessLocation } from '@/lib/verifiedLocation';
import { GbpMediaCategory } from '@/lib/gbpClient';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 75 * 1024 * 1024; // 75 MB (Google's own limit is 75MB / 30s)
const ALLOWED_IMAGE = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime'];
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

  const isVideo = ALLOWED_VIDEO.includes(file.type);
  const isImage = ALLOWED_IMAGE.includes(file.type);
  if (!isVideo && !isImage) {
    return NextResponse.json({ success: false, error: 'Only JPG, PNG, WebP images or MP4 / MOV video are allowed.' }, { status: 400 });
  }
  if (isVideo && category !== 'ADDITIONAL') {
    return NextResponse.json({ success: false, error: 'Video can only be added as an additional post — not as a logo, cover or profile photo.' }, { status: 400 });
  }
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return NextResponse.json(
      { success: false, error: isVideo ? 'Video must be 75 MB or smaller.' : 'Image must be 10 MB or smaller.' },
      { status: 400 },
    );
  }

  try {
    // Cover/logo crop (server-side, EXIF kept) + ONE geotag policy for photos
    // and videos: the file's own location first, then the photo's own EXIF
    // reported by the app, then the business's verified Google location.
    // The phone's current GPS is not used when that verified location exists.
    // Photos get GPS written into EXIF; videos are stored byte-for-byte and the
    // location is recorded on the asset.
    const prepared = await prepareGalleryMedia({
      buffer: Buffer.from(await file.arrayBuffer()),
      mime: file.type,
      category,
      location: await getVerifiedBusinessLocation(ctx.businessId),
      photoLocation: photoLocationFromForm(form),
    });
    const publicUrl = await uploadPublicObject(prepared.buffer, prepared.mime, `gbp-media/${ctx.businessId}`);

    const asset = await createOrReplaceStagedAsset({
      businessId: ctx.businessId,
      organizationId: ctx.organizationId,
      uploadedBy: ctx.userId,
      category,
      url: publicUrl,
      mediaType: isVideo ? 'video' : 'photo',
      geotag: prepared.geotag,
    });

    return NextResponse.json({ success: true, asset });
  } catch (err: any) {
    console.error('[gbp/media/upload] failed:', err);
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}
