import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Testimonial from '@/models/Testimonial';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

export const dynamic = 'force-dynamic';

/**
 * Public, no-login feed for growwmatics.com/showcase — approved client
 * testimonials about GrowwMatics itself, across every business. The
 * business name is always the submitting workspace's own Business.name
 * (populated here, never free-typed at submission) — see
 * src/models/Testimonial.ts.
 */
export async function GET(req: Request) {
  const ip = getClientIp(req);
  const rate = checkRateLimit(`public-testimonials:${ip}`, 60, 60 * 1000);
  if (!rate.allowed && !isQaTestingMode()) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 });
  }

  try {
    await dbConnect();
    const testimonials = await Testimonial.find({ status: 'approved' })
      .populate('businessId', 'name')
      .sort({ createdAt: -1 })
      .limit(48)
      .lean();

    const items = testimonials.map((t: any) => ({
      id: t._id,
      reviewerName: t.reviewerName,
      rating: t.rating,
      reviewText: t.reviewText,
      photoUrl: t.photoUrl ?? null,
      businessName: t.businessId?.name ?? null,
      reviewedAt: t.createdAt,
    }));

    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error('[public/testimonials]', error);
    return NextResponse.json({ error: 'Something went wrong on our end. Please try again shortly.' }, { status: 500 });
  }
}
