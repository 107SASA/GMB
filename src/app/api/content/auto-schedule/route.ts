import { NextResponse } from 'next/server';
import { z } from 'zod';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { inngest } from '@/services/inngest/client';

const schema = z.object({
  postIds: z.array(z.string().min(1)).min(1),
});

function at9AM(date: Date): Date {
  const d = new Date(date);
  d.setHours(9, 0, 0, 0);
  return d;
}

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    // ADDITIVE (Sep 2026) — content_studio was never actually enforced
    // server-side; see lib/moduleGating.ts.
    const gate = await requireModule(ctx.userId, 'content_studio');
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { postIds } = parsed.data;
    const businessObjId = new mongoose.Types.ObjectId(ctx.businessId);

    await dbConnect();

    // Find the latest currently-scheduled post
    const lastScheduled = await Post.findOne({
      businessId: businessObjId,
      status: 'scheduled',
      scheduledDate: { $exists: true },
    }).sort({ scheduledDate: -1 }).lean();

    // Start the day after the last scheduled post, or tomorrow if none
    let startDate: Date;
    if (lastScheduled?.scheduledDate) {
      startDate = new Date(lastScheduled.scheduledDate);
      startDate.setDate(startDate.getDate() + 1);
      startDate = at9AM(startDate);
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      startDate = at9AM(tomorrow);
    }

    // Schedule each post on ALTERNATE days (every other day) so a week of
    // content stays spread out — e.g. Mon, Wed, Fri, Sun — keeping the profile
    // active throughout the week instead of bunched on consecutive days.
    const scheduledDates: string[] = [];
    const scheduledEvents: { name: 'scheduler/post-scheduled'; data: { postId: string; scheduledDate: string } }[] = [];
    for (let i = 0; i < postIds.length; i++) {
      const scheduledDate = new Date(startDate);
      scheduledDate.setDate(startDate.getDate() + i * 2);

      await Post.updateOne(
        { _id: new mongoose.Types.ObjectId(postIds[i]), businessId: businessObjId },
        { $set: { status: 'scheduled', scheduledDate } }
      );

      scheduledDates.push(scheduledDate.toISOString());
      // updateOne (not .save()) so there's no model hook to piggyback on —
      // fire the event explicitly here, same scheduledDate just written.
      scheduledEvents.push({
        name: 'scheduler/post-scheduled',
        data: { postId: postIds[i], scheduledDate: scheduledDate.toISOString() },
      });
    }
    if (scheduledEvents.length > 0) {
      void inngest.send(scheduledEvents).catch((err) =>
        console.error('[content/auto-schedule] post-scheduled events failed:', err)
      );
    }

    return NextResponse.json({
      success: true,
      count: postIds.length,
      firstDate: scheduledDates[0],
      lastDate: scheduledDates[scheduledDates.length - 1],
      scheduledDates,
    });
  } catch (error: any) {
    console.error('Auto-schedule error:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
