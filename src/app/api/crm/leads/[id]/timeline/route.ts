import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Activity from '@/models/Activity';
import FollowUp from '@/models/FollowUp';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const { id } = resolvedParams;
    
    await dbConnect();

    const [activities, followUps] = await Promise.all([
      Activity.find({ leadId: id }).sort({ createdAt: -1 }).lean(),
      FollowUp.find({ leadId: id }).sort({ createdAt: -1 }).lean()
    ]);

    // Combine and sort by date descending
    const timeline = [
      ...activities.map(a => ({ ...a, timelineType: 'activity', date: a.createdAt })),
      ...followUps.map(f => ({ ...f, timelineType: 'followUp', date: f.createdAt }))
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({ success: true, timeline });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
