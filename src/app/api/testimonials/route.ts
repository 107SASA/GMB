import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import Testimonial from '@/models/Testimonial';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * A client's testimonial about GrowwMatics itself, submitted in one go
 * (name, rating, text, optional photo). Always lands as status:'pending';
 * a superadmin approves it (PATCH /api/admin/testimonials/[id]) before it
 * shows on growwmatics.com/showcase. See src/models/Testimonial.ts.
 *
 * The business name shown alongside it is never taken from this request —
 * it's resolved from Business.name via businessId at read time (see
 * GET /api/public/testimonials), so it can't be spoofed here.
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    const body = await req.json();
    const reviewerName = typeof body.reviewerName === 'string' ? body.reviewerName.trim() : '';
    const reviewText = typeof body.reviewText === 'string' ? body.reviewText.trim() : '';
    const rating = Number(body.rating);
    const photoUrl = typeof body.photoUrl === 'string' && body.photoUrl.trim() ? body.photoUrl.trim() : undefined;

    if (!reviewerName) {
      return NextResponse.json({ success: false, error: 'Your name is required.' }, { status: 400 });
    }
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ success: false, error: 'Rating must be between 1 and 5.' }, { status: 400 });
    }
    if (!reviewText) {
      return NextResponse.json({ success: false, error: 'Review text is required.' }, { status: 400 });
    }

    const testimonial = await Testimonial.create({
      businessId: ctx.businessId,
      addedBy: ctx.userId,
      reviewerName,
      rating,
      reviewText,
      photoUrl,
      status: 'pending',
    });

    return NextResponse.json({ success: true, testimonial }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}

/** The caller's own testimonial submissions, newest first — every status included. */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    const testimonials = await Testimonial.find({ businessId: ctx.businessId })
      .sort({ createdAt: -1 })
      .lean();
    return NextResponse.json({ success: true, testimonials });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}
