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

      // The stored field is `name` (reading `businessName` left every name blank).
      Business.find({ isDeleted: { $ne: true } }).select('_id name googleConnected subscriptionStatus').lean(),
    ]);

    // Business name map
    const bizMap: Record<string, string> = {};
    allBusinesses.forEach((b: any) => { bizMap[b._id.toString()] = b.name; });

    const recentPosts = recentPostsRaw.map((p: any) => ({
      _id: p._id,
      businessName: bizMap[p.businessId?.toString()] ?? 'Unknown',
      title: p.title ?? '(no title)',
      status: p.status,
      scheduledDate: p.scheduledDate ?? null,
      createdAt: p.createdAt,
    }));

    // Buffer health — only businesses that can post: Google connected, or
    // already have posts. (Every free-report account used to be listed, all
    // at 0, pushing the real ones off the top 10.) Per business: scheduled
    // posts still ahead, scheduled posts whose time has passed without
    // publishing (overdue — the hourly publisher retries them), and the next one.
    const bufferCounts = await Post.aggregate([
      { $match: { status: 'scheduled' } },
      {
        $group: {
          _id: '$businessId',
          scheduledAhead: { $sum: { $cond: [{ $gte: ['$scheduledDate', now] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $lt: ['$scheduledDate', now] }, 1, 0] } },
          nextPostAt: { $min: { $cond: [{ $gte: ['$scheduledDate', now] }, '$scheduledDate', null] } },
        },
      },
    ]);
    const withPosts = new Set((await Post.distinct('businessId')).map(String));

    const bufferMap: Record<string, { scheduledAhead: number; overdue: number; nextPostAt: Date | null }> = {};
    bufferCounts.forEach((row: any) => {
      bufferMap[row._id?.toString()] = { scheduledAhead: row.scheduledAhead, overdue: row.overdue, nextPostAt: row.nextPostAt ?? null };
    });

    const bufferHealth = allBusinesses
      .filter((b: any) => b.googleConnected === true || withPosts.has(b._id.toString()))
      .map((b: any) => ({
        businessId: b._id.toString(),
        businessName: b.name || '(unnamed business)',
        googleConnected: b.googleConnected === true,
        subscriptionStatus: b.subscriptionStatus ?? null,
        scheduledAhead: bufferMap[b._id.toString()]?.scheduledAhead ?? 0,
        overdue: bufferMap[b._id.toString()]?.overdue ?? 0,
        nextPostAt: bufferMap[b._id.toString()]?.nextPostAt ?? null,
      }))
      .sort((a, b) => a.scheduledAhead - b.scheduledAhead || b.overdue - a.overdue || a.businessName.localeCompare(b.businessName))
      .slice(0, 50);

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          overdueCount: bufferCounts.reduce((sum: number, row: any) => sum + (row.overdue || 0), 0),
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
