import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { uploadPublicObject, isStorageConfigured } from '@/lib/storage';
import ShowcaseAsset, { ShowcaseMediaType } from '@/models/ShowcaseAsset';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 80 * 1024 * 1024; // 80 MB — caps storage/bandwidth growth (see cost model)
const PHOTO_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

/**
 * Client uploads a photo/video for the public GrowwMatics showcase
 * (growwmatics.com/showcase). Always lands as status:'pending' — nothing
 * here ever goes live on its own; a superadmin has to approve it first
 * (POST /api/admin/showcase/[id]). See src/models/ShowcaseAsset.ts.
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

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
  const captionRaw = form.get('caption');
  const caption = typeof captionRaw === 'string' && captionRaw.trim() ? captionRaw.trim().slice(0, 400) : undefined;
  const featureBusinessName = String(form.get('featureBusinessName') || '') === 'true';

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'No file uploaded.' }, { status: 400 });
  }

  let mediaType: ShowcaseMediaType;
  if (PHOTO_TYPES.includes(file.type)) {
    mediaType = 'photo';
    if (file.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ success: false, error: 'Photos must be 10 MB or smaller.' }, { status: 400 });
    }
  } else if (VIDEO_TYPES.includes(file.type)) {
    mediaType = 'video';
    if (file.size > MAX_VIDEO_BYTES) {
      return NextResponse.json({ success: false, error: 'Videos must be 80 MB or smaller — trim the clip and try again.' }, { status: 400 });
    }
  } else {
    return NextResponse.json({ success: false, error: 'Only JPG, PNG, WebP photos or MP4, MOV, WebM videos are allowed.' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const publicUrl = await uploadPublicObject(buffer, file.type, `showcase/${ctx.businessId}`);

    const asset = await ShowcaseAsset.create({
      businessId: ctx.businessId,
      uploadedBy: ctx.userId,
      mediaType,
      url: publicUrl,
      caption,
      featureBusinessName,
      status: 'pending',
    });

    return NextResponse.json({ success: true, asset });
  } catch (err: any) {
    console.error('[showcase/upload] failed:', err);
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}
