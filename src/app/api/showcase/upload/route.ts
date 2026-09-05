import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { uploadPublicObject, isStorageConfigured } from '@/lib/storage';
import ShowcaseAsset, { ShowcaseMediaType } from '@/models/ShowcaseAsset';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_VIDEO_BYTES = 80 * 1024 * 1024; // 80 MB — caps storage/bandwidth growth (see cost model)
// Recorded in-browser via MediaRecorder (see SuccessStoriesWorkspace.tsx) —
// webm is what every browser's MediaRecorder actually produces; mp4/mov
// stay accepted too in case a caller ever sends a native recording directly.
const VIDEO_TYPES = ['video/webm', 'video/mp4', 'video/quicktime'];

/**
 * Client uploads a video for the public GrowwMatics showcase
 * (growwmatics.com/showcase). Always lands as status:'pending' — nothing
 * here ever goes live on its own; a superadmin has to approve it first
 * (POST /api/admin/showcase/[id]). See src/models/ShowcaseAsset.ts.
 *
 * Photo upload was REMOVED (owner's explicit call, Sep 2026) — the
 * dashboard form only ever records+submits video now, so this only accepts
 * video/*; a photo content-type is rejected outright rather than silently
 * still being accepted by an API surface the UI no longer offers.
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

  // One-time-only (owner's explicit call, Sep 2026) — a business gets
  // exactly one video submission. A prior 'rejected' one doesn't count
  // against this — see the matching comment in /api/testimonials.
  const already = await ShowcaseAsset.exists({ businessId: ctx.businessId, mediaType: 'video', status: { $ne: 'rejected' } });
  if (already) {
    return NextResponse.json({ success: false, error: 'You have already submitted a video.' }, { status: 409 });
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

  const mediaType: ShowcaseMediaType = 'video';
  if (!VIDEO_TYPES.includes(file.type)) {
    return NextResponse.json({ success: false, error: 'Only MP4, MOV, or WebM videos are allowed.' }, { status: 400 });
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return NextResponse.json({ success: false, error: 'Videos must be 80 MB or smaller — trim the clip and try again.' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const publicUrl = await uploadPublicObject(buffer, file.type, `showcase/${ctx.businessId}`);

    let asset;
    try {
      asset = await ShowcaseAsset.create({
        businessId: ctx.businessId,
        uploadedBy: ctx.userId,
        mediaType,
        url: publicUrl,
        caption,
        featureBusinessName,
        status: 'pending',
      });
    } catch (err: any) {
      // The exists() pre-check above is a fast path, not the real guard — it
      // has a TOCTOU gap (a double-tap/retry can both pass it before either
      // create() lands). ShowcaseAssetSchema's partial unique index on
      // businessId (scoped to mediaType:'video') is what actually makes a
      // second one impossible; a race that slips past the pre-check
      // surfaces here as E11000 instead. The video is already uploaded to
      // Spaces at this point — an orphaned object there is an acceptable
      // cost for correctly refusing the duplicate submission.
      if (err?.code === 11000) {
        return NextResponse.json({ success: false, error: 'You have already submitted a video.' }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({ success: true, asset });
  } catch (err: any) {
    console.error('[showcase/upload] failed:', err);
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}
