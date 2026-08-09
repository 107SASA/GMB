import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import dbConnect from '@/lib/mongodb';
import ProfileActivity from '@/models/ProfileActivity';

export const dynamic = 'force-dynamic';

/**
 * GET -> recent real profile-change events (profile edits, photo publishes —
 * see logProfileActivity.ts for the writers) for the mobile Home "AI
 * Actions" feed. Capped at 10; this is a recent-activity strip, not a full
 * audit-log page.
 */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  await dbConnect();
  const activity = await ProfileActivity.find({ businessId: ctx.businessId })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  return NextResponse.json({ success: true, activity });
}
