import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ShowcaseAsset from '@/models/ShowcaseAsset';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

export const dynamic = 'force-dynamic';

/**
 * Public, no-login feed for growwmatics.com/showcase — approved media only.
 * A business's name is included only when they opted in at upload time
 * (featureBusinessName); rejected/pending items are never reachable here.
 */
export async function GET(req: Request) {
  const ip = getClientIp(req);
  const rate = checkRateLimit(`public-showcase:${ip}`, 60, 60 * 1000);
  if (!rate.allowed && !isQaTestingMode()) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 });
  }

  try {
    await dbConnect();
    const assets = await ShowcaseAsset.find({ status: 'approved' })
      .populate('businessId', 'name')
      .sort({ publishedAt: -1 })
      .limit(48)
      .lean();

    const items = assets.map((a: any) => ({
      id: a._id,
      mediaType: a.mediaType,
      url: a.url,
      caption: a.caption ?? null,
      businessName: a.featureBusinessName ? (a.businessId?.name ?? null) : null,
      publishedAt: a.publishedAt,
    }));

    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error('[public/showcase]', error);
    return NextResponse.json({ error: 'Something went wrong on our end. Please try again shortly.' }, { status: 500 });
  }
}
