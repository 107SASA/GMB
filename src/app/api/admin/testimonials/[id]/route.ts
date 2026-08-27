import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import dbConnect from '@/lib/mongodb';
import Testimonial from '@/models/Testimonial';
import { notifyBusinessUsers } from '@/services/notifications';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * Approve or reject one testimonial. Approving is what makes it appear on
 * growwmatics.com/showcase (GET /api/public/testimonials) — no further
 * action needed once approved.
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

    const testimonial = await Testimonial.findByIdAndUpdate(
      id,
      {
        $set: {
          status,
          reviewedBy: auth.userId,
          reviewedAt: new Date(),
          ...(rejectionReason ? { rejectionReason } : {}),
        },
      },
      { new: true },
    );

    if (!testimonial) {
      return NextResponse.json({ success: false, error: 'Testimonial not found.' }, { status: 404 });
    }

    await notifyBusinessUsers(testimonial.businessId.toString(), {
      type: status === 'approved' ? 'testimonial_approved' : 'testimonial_rejected',
      title: status === 'approved' ? 'Testimonial approved' : 'Testimonial rejected',
      body: status === 'approved'
        ? 'Your testimonial is now live on growwmatics.com/showcase.'
        : `Your submitted testimonial wasn't approved.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
      link: '/dashboard/success-stories?tab=reviews',
    });

    return NextResponse.json({ success: true, testimonial });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}

/**
 * Removes a testimonial outright — including one that's already 'approved'
 * and live on growwmatics.com/showcase, which stops appearing immediately
 * since GET /api/public/testimonials only ever reads what's still in the
 * collection.
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

    const testimonial = await Testimonial.findByIdAndDelete(id);
    if (!testimonial) {
      return NextResponse.json({ success: false, error: 'Testimonial not found.' }, { status: 404 });
    }

    await notifyBusinessUsers(testimonial.businessId.toString(), {
      type: 'testimonial_removed',
      title: 'Testimonial removed',
      body: 'Your testimonial was removed from growwmatics.com/showcase by our team.',
      link: '/dashboard/success-stories?tab=reviews',
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
