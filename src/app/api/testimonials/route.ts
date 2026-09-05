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
    // One-time-only (owner's explicit call, Sep 2026) — a business gets
    // exactly one review submission. A prior 'rejected' one doesn't count
    // against this; only a still-pending or already-approved one blocks a
    // resubmit, matching /api/success-stories/status's own definition of
    // "done" so the two can never disagree.
    const already = await Testimonial.exists({ businessId: ctx.businessId, status: { $ne: 'rejected' } });
    if (already) {
      return NextResponse.json({ success: false, error: 'You have already submitted a review.' }, { status: 409 });
    }

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

    let testimonial;
    try {
      testimonial = await Testimonial.create({
        businessId: ctx.businessId,
        addedBy: ctx.userId,
        reviewerName,
        rating,
        reviewText,
        photoUrl,
        status: 'pending',
      });
    } catch (err: any) {
      // The exists() pre-check above is a fast path, not the real guard — it
      // has a TOCTOU gap (a double-tap/retry can both pass it before either
      // create() lands). TestimonialSchema's partial unique index on
      // businessId is what actually makes a second one impossible; a race
      // that slips past the pre-check surfaces here as E11000 instead.
      if (err?.code === 11000) {
        return NextResponse.json({ success: false, error: 'You have already submitted a review.' }, { status: 409 });
      }
      throw err;
    }

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
