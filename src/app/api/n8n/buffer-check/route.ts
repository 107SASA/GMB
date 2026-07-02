import { NextResponse } from 'next/server';
import { validateApiKey } from '@/middleware/apiKeyAuth';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Post from '@/models/Post';
import mongoose from 'mongoose';

export async function GET(req: Request) {
  const auth = validateApiKey(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get('businessId');

  if (!businessId) {
    return NextResponse.json(
      { success: false, error: 'businessId query param is required' },
      { status: 400 }
    );
  }

  try {
    await dbConnect();

    const business = await Business.findById(businessId).select('name isActive').lean();
    if (!business) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }

    const bid = new mongoose.Types.ObjectId(businessId);
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const upcomingPosts = await Post.find({
      businessId: bid,
      status: 'scheduled',
      scheduledDate: { $gte: now, $lte: sevenDaysFromNow },
    }).lean();

    const uniqueDays = new Set(
      upcomingPosts.map((p: any) => new Date(p.scheduledDate).toDateString())
    ).size;

    let healthStatus = 'Healthy';
    if (uniqueDays < 4) healthStatus = 'Critical';
    else if (uniqueDays < 7) healthStatus = 'Warning';

    return NextResponse.json({
      success: true,
      businessId,
      businessName: (business as any).name,
      bufferDays: uniqueDays,
      missingDays: Math.max(0, 7 - uniqueDays),
      healthStatus,
      scheduledCount: upcomingPosts.length,
    });
  } catch (error: any) {
    console.error('[n8n/buffer-check]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
