import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import { requireBusinessContext } from '@/lib/tenant';
import mongoose from 'mongoose';

export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const bid = new mongoose.Types.ObjectId(ctx.businessId);
    const now = new Date();
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(now.getDate() + 7);

    const upcomingPosts = await Post.find({
      businessId: bid,
      status: 'scheduled',
      scheduledDate: { $gte: now, $lte: sevenDaysFromNow },
    }).sort({ scheduledDate: 1 }).lean();

    const uniqueDaysCovered = new Set(
      upcomingPosts.map(p => new Date(p.scheduledDate!).toDateString())
    ).size;

    const missingDays = Math.max(0, 7 - uniqueDaysCovered);

    let healthStatus = 'Healthy';
    if (uniqueDaysCovered < 4) healthStatus = 'Critical';
    else if (uniqueDaysCovered < 7) healthStatus = 'Warning';

    const calendarStart = new Date(now);
    calendarStart.setDate(now.getDate() - 7);
    const calendarEnd = new Date(now);
    calendarEnd.setDate(now.getDate() + 14);

    const allCalendarPosts = await Post.find({
      businessId: bid,
      $or: [
        { scheduledDate: { $gte: calendarStart, $lte: calendarEnd } },
        { publishedAt: { $gte: calendarStart, $lte: calendarEnd } },
        { status: 'draft' },
      ],
    }).sort({ createdAt: -1 }).lean();

    return NextResponse.json({
      success: true,
      data: {
        totalScheduledPosts: upcomingPosts.length,
        daysCovered: uniqueDaysCovered,
        healthStatus,
        missingDays,
        upcomingPosts,
        allPosts: allCalendarPosts,
      },
    }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to fetch scheduler buffer:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
