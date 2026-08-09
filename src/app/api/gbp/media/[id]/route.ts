import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import { updateAssetCategory, deleteAsset } from '@/lib/gbpMediaService';
import { GBPAuthError } from '@/lib/gbpClient';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  category: z.enum(['LOGO', 'COVER', 'ADDITIONAL', 'PROFILE']),
});

/**
 * PATCH -> change a staged photo's category. 400s if the photo is already
 * published — Google's API has no way to move a live photo between
 * categories, only delete + re-upload, which we don't do implicitly (see
 * GbpMediaAsset.ts).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  try {
    const asset = await updateAssetCategory(ctx.businessId, id, parsed.data.category);
    return NextResponse.json({ success: true, asset });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Failed to update category' }, { status: 400 });
  }
}

/**
 * DELETE -> removes a photo. Staged/failed photos are local-only. Published
 * photos require GBP_LIVE_WRITES_ENABLED (same gate as every other live
 * write) since this calls Google's real delete API for them.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const { id } = await params;

  try {
    await deleteAsset(ctx.businessId, id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err instanceof GBPAuthError) {
      return NextResponse.json({ success: false, error: 'Google connection expired — please reconnect.' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: err.message || 'Failed to delete photo' }, { status: 400 });
  }
}
