import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import FollowUp from '@/models/FollowUp';

export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    const followups = await FollowUp.find()
      .populate('leadId', 'name phone status intentScore')
      .sort({ scheduledAt: -1 });
      
    return NextResponse.json(followups);
  } catch (error) {
    console.error('Error fetching followups:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
