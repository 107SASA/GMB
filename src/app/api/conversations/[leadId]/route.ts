import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Conversation from '@/models/Conversation';

export async function GET(req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    await dbConnect();
    const resolvedParams = await params;
    const { leadId } = resolvedParams;

    const conversations = await Conversation.find({ leadId }).sort({ timestamp: 1 });
    return NextResponse.json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
