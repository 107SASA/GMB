import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import dbConnect from '@/lib/mongodb';
import ShowcaseAsset from '@/models/ShowcaseAsset';
import { notifyBusinessUsers } from '@/services/notifications';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * Approve or reject one showcase submission. Approving is what makes it
 * "post automatically" — the moment status flips to 'approved' it starts
 * being returned by GET /api/public/showcase, no further action needed.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const status = body?.status;
    if (status !== 'approved' && status !== 'rejected') {
      return NextResponse.json({ success: false, error: "status must be 'approved' or 'rejected'." }, { status: 400 });
    }
    const rejectionReason = status === 'rejected' && typeof body?.rejectionReason === 'string'
      ? body.rejectionReason.trim().slice(0, 400)
      : undefined;

    await dbConnect();

    const asset = await ShowcaseAsset.findByIdAndUpdate(
      id,
      {
        $set: {
          status,
          reviewedBy: auth.userId,
          reviewedAt: new Date(),
          ...(status === 'approved' ? { publishedAt: new Date() } : {}),
          ...(rejectionReason ? { rejectionReason } : {}),
        },
      },
      { new: true },
    );

    if (!asset) {
      return NextResponse.json({ success: false, error: 'Showcase item not found.' }, { status: 404 });
    }

    await notifyBusinessUsers(asset.businessId.toString(), {
      type: status === 'approved' ? 'showcase_approved' : 'showcase_rejected',
      title: status === 'approved' ? 'Showcase upload approved' : 'Showcase upload rejected',
      body: status === 'approved'
        ? 'Your photo/video is now live on the GrowwMatics showcase.'
        : `Your showcase upload wasn't approved.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
      link: '/dashboard/success-stories?tab=photos',
    });

    return NextResponse.json({ success: true, asset });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}

/**
 * Removes a showcase item outright — including one that's already
 * 'approved' and live on /showcase, which stops appearing immediately
 * since GET /api/public/showcase only ever reads what's still in the
 * collection. Mirrors DELETE /api/gbp/media/[id]'s scope: the Mongo record
 * only, the DigitalOcean Spaces object is left in place (same tradeoff
 * that route already makes).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
    }

    await dbConnect();

    const asset = await ShowcaseAsset.findByIdAndDelete(id);
    if (!asset) {
      return NextResponse.json({ success: false, error: 'Showcase item not found.' }, { status: 404 });
    }

    await notifyBusinessUsers(asset.businessId.toString(), {
      type: 'showcase_removed',
      title: 'Showcase upload removed',
      body: 'A photo/video you uploaded was removed from the GrowwMatics showcase by our team.',
      link: '/dashboard/success-stories?tab=photos',
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
