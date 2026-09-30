import { NextResponse } from 'next/server';
import { z } from 'zod';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import WeeklyOffer from '@/models/WeeklyOffer';
import GbpMediaAsset from '@/models/GbpMediaAsset';
import { requireBusinessContext } from '@/lib/tenant';
import { festivalsBetween } from '@/lib/festivalCalendar';
import { contentWeekKey, contentWeekStart } from '@/services/content/plan';
import { inngest } from '@/services/inngest/client';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * Weekly "Anything to promote this week?" question (Sep 2026).
 * Asked once per business per India-time week; the answer is stored as a
 * WeeklyOffer (unique per business+week). Only the owner's own words become
 * an offer post — nothing is inferred from the website or invented by AI.
 */

export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    await dbConnect();
    const business: any = await Business.findById(ctx.businessId).select('subscriptionStatus googleConnected').lean();
    const now = new Date();
    const weekKey = contentWeekKey(now);
    const answer: any = await WeeklyOffer.findOne({ businessId: ctx.businessId, weekKey }).lean();
    // Only businesses whose weekly posts run (paid + Google connected) are asked.
    const eligible = business?.subscriptionStatus === 'active' && !!business?.googleConnected;
    const photos = eligible && !answer
      ? await GbpMediaAsset.find({ businessId: ctx.businessId, category: { $in: ['ADDITIONAL', 'COVER'] }, status: { $in: ['published', 'staged'] }, url: { $regex: '^https://' } })
          .sort({ createdAt: -1 }).limit(8).select('url').lean()
      : [];
    return NextResponse.json({
      success: true,
      eligible,
      weekKey,
      answered: answer ? answer.status : null,
      offer: answer?.status === 'YES' ? { text: answer.text, festivalName: answer.festivalName ?? null } : null,
      festivals: festivalsBetween(now, 14).map((f) => ({ name: f.name, date: f.date, approximate: !!f.approximate })),
      photos: (photos as any[]).map((p) => ({ id: String(p._id), url: p.url })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}

const bodySchema = z.object({
  answer: z.enum(['yes', 'no', 'dismiss']),
  text: z.string().trim().max(600).optional(),
  festivalName: z.string().trim().max(60).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  imageId: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    const b = parsed.data;
    if (b.answer === 'yes' && (!b.text || b.text.length < 5)) {
      return NextResponse.json({ error: 'Please describe the offer in a few words.' }, { status: 400 });
    }
    await dbConnect();
    const now = new Date();
    const weekKey = contentWeekKey(now);
    const key = { businessId: new mongoose.Types.ObjectId(ctx.businessId), weekKey };

    if (b.answer === 'dismiss') {
      // Dismiss never overwrites a real answer; it only stops this week's popup.
      await WeeklyOffer.updateOne(key, { $setOnInsert: { ...key, weekStart: contentWeekStart(now), status: 'DISMISSED', answeredBy: ctx.userId } }, { upsert: true });
      return NextResponse.json({ success: true, answered: 'DISMISSED' });
    }

    const existing: any = await WeeklyOffer.findOne(key).lean();
    if (existing?.postId && existing.status === 'YES') {
      return NextResponse.json({ error: 'This week\'s offer is already in a post. Edit that post in Content instead.' }, { status: 409 });
    }
    let imageId: string | undefined;
    if (b.imageId && mongoose.isValidObjectId(b.imageId)) {
      const asset = await GbpMediaAsset.exists({ _id: b.imageId, businessId: ctx.businessId });
      if (asset) imageId = b.imageId;
    }
    const date = (s?: string) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s) : undefined);
    const set = b.answer === 'yes'
      ? { status: 'YES', text: b.text, festivalName: b.festivalName || undefined, startsAt: date(b.startsAt), endsAt: date(b.endsAt), imageId, answeredBy: ctx.userId }
      : { status: 'NONE', answeredBy: ctx.userId };
    const unset = b.answer === 'yes' ? {} : { text: 1, festivalName: 1, startsAt: 1, endsAt: 1, imageId: 1 };
    try {
      await WeeklyOffer.updateOne(key, { $set: set, $unset: unset, $setOnInsert: { weekStart: contentWeekStart(now) } }, { upsert: true });
    } catch (err: any) {
      if (err?.code !== 11000) throw err; // two tabs answering at once — the first write stands
    }
    if (b.answer === 'yes') {
      await inngest.send({ name: 'content/weekly-offer.answered', data: { businessId: ctx.businessId, weekKey } }).catch((e) => console.error('[weekly-offer] dispatch failed:', e?.message));
    }
    return NextResponse.json({ success: true, answered: set.status });
  } catch (err: any) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}
