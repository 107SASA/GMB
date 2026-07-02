import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Post from '@/models/Post';
import Business from '@/models/Business';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const now = new Date();

    const [
      totalPosts,
      scheduledCount,
      publishedCount,
      draftCount,
      failedCount,
      recentPostsRaw,
      allBusinesses,
    ] = await Promise.all([
      Post.countDocuments(),
      Post.countDocuments({ status: 'scheduled' }),
      Post.countDocuments({ status: 'published' }),
      Post.countDocuments({ status: 'draft' }),
      Post.countDocuments({ status: 'failed' }),

      Post.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .select('businessId title status scheduledDate createdAt')
        .lean(),

      Business.find().select('_id businessName').lean(),
    ]);

    // Business name map
    const bizMap: Record<string, string> = {};
    allBusinesses.forEach((b: any) => { bizMap[b._id.toString()] = b.businessName; });

    const recentPosts = recentPostsRaw.map((p: any) => ({
      _id: p._id,
      businessName: bizMap[p.businessId?.toString()] ?? 'Unknown',
      title: p.title ?? '(no title)',
      status: p.status,
      scheduledDate: p.scheduledDate ?? null,
      createdAt: p.createdAt,
    }));

    // Buffer health: for each business, count scheduled posts with scheduledDate >= now
    const bufferCounts = await Post.aggregate([
      { $match: { status: 'scheduled', scheduledDate: { $gte: now } } },
      { $group: { _id: '$businessId', scheduledAhead: { $sum: 1 } } },
    ]);

    const bufferMap: Record<string, number> = {};
    bufferCounts.forEach((row: any) => { bufferMap[row._id?.toString()] = row.scheduledAhead; });

    const bufferHealth = allBusinesses
      .map((b: any) => ({
        businessId: b._id.toString(),
        businessName: b.businessName,
        scheduledAhead: bufferMap[b._id.toString()] ?? 0,
      }))
      .sort((a, b) => a.scheduledAhead - b.scheduledAhead)
      .slice(0, 10);

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalPosts,
          scheduledCount,
          publishedCount,
          draftCount,
          failedCount,
        },
        recentPosts,
        bufferHealth,
      },
    });
  } catch (error: any) {
    console.error('Content Monitor Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch content data' },
      { status: 500 }
    );
  }
}
