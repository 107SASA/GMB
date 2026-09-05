import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { POSTS_PER_WEEK } from '@/lib/contentConfig';
import mongoose from 'mongoose';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    // ADDITIVE (Sep 2026) — content_studio was never actually enforced
    // server-side; see lib/moduleGating.ts.
    const gate = await requireModule(ctx.userId, 'content_studio');
    if (!gate.ok) return gate.response;

    await dbConnect();

    const bid = new mongoose.Types.ObjectId(ctx.businessId);
    const now = new Date();
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(now.getDate() + 7);

    // Buffer is measured against the weekly content CADENCE (POSTS_PER_WEEK),
    // not "unique days out of 7". We generate 4 posts/week on alternate days, so
    // a fully-stocked week can never cover 7 distinct days — the old model made
    // a healthy buffer read as perpetually "Warning". Count scheduled posts in
    // the upcoming 7 days and compare against the weekly target instead.
    const upcomingPosts = await Post.find({
      businessId: bid,
      status: 'scheduled',
      scheduledDate: { $gte: now, $lte: sevenDaysFromNow },
    }).sort({ scheduledDate: 1 }).lean();

    const weeklyTarget = POSTS_PER_WEEK;
    const scheduledThisWeek = upcomingPosts.length;
    const postsNeeded = Math.max(0, weeklyTarget - scheduledThisWeek);

    let healthStatus = 'Healthy';
    if (scheduledThisWeek === 0) healthStatus = 'Critical';
    else if (scheduledThisWeek < weeklyTarget) healthStatus = 'Warning';

    // Draft posts sitting unscheduled — surfaced so the UI can nudge the user to
    // schedule them rather than treating the week as empty.
    const unscheduledDrafts = await Post.countDocuments({
      businessId: bid,
      status: 'draft',
      aiGenerated: true,
    });

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
        weeklyTarget,
        scheduledThisWeek,
        postsNeeded,
        unscheduledDrafts,
        healthStatus,
        upcomingPosts,
        allPosts: allCalendarPosts,
      },
    }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to fetch scheduler buffer:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
