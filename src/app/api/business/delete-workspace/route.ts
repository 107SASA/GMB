import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import GBPToken from '@/models/GBPToken';
import User from '@/models/User';
import { requireClient } from '@/lib/auth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * Soft-deletes one of the signed-in user's workspaces (Business). The workspace
 * disappears from the switcher (the list route filters isDeleted), its Google
 * connection token is removed, and it's dropped from User.businessIds. If it was
 * the active workspace, the active pointer moves to another remaining workspace.
 *
 * Soft delete (isDeleted) — not a hard delete — so audits/reviews/leads history
 * isn't orphaned. The placeId is per-organization, and each workspace has its
 * own organization, so re-adding the same business later still works.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireClient();
    if (!auth.ok) return auth.response;

    const { businessId } = await req.json();
    if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
      return NextResponse.json({ success: false, error: 'A valid businessId is required.' }, { status: 400 });
    }

    await dbConnect();

    // Must belong to the caller and not already deleted.
    const business = await Business.findOne({ _id: businessId, userId: auth.userId, isDeleted: { $ne: true } });
    if (!business) {
      return NextResponse.json({ success: false, error: 'Workspace not found or access denied.' }, { status: 404 });
    }

    business.isDeleted = true;
    await business.save();

    await GBPToken.deleteOne({ businessId: business._id });
    await User.updateOne({ _id: auth.userId }, { $pull: { businessIds: business._id } });

    // If this was the active workspace, move the pointer to another one.
    const remaining = await Business.find({ userId: auth.userId, isDeleted: { $ne: true } })
      .select('_id')
      .sort({ createdAt: 1 })
      .lean();
    const nextActive = remaining[0]?._id?.toString() ?? null;

    const cookieStore = await cookies();
    const activeCookie = cookieStore.get('activeBusinessId')?.value;
    if (activeCookie === String(business._id)) {
      if (nextActive) {
        cookieStore.set('activeBusinessId', nextActive, {
          path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 30,
        });
      } else {
        cookieStore.delete('activeBusinessId');
      }
    }
    await User.updateOne(
      { _id: auth.userId, activeBusinessId: business._id },
      nextActive
        ? { $set: { activeBusinessId: new mongoose.Types.ObjectId(nextActive) } }
        : { $unset: { activeBusinessId: '' } }
    );

    return NextResponse.json({ success: true, nextActiveBusinessId: nextActive });
  } catch (error: any) {
    console.error('Delete workspace error:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
