import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import mongoose from 'mongoose';
import Lead from '@/models/Lead';
import Conversation from '@/models/Conversation';
import { requireBusinessContext } from '@/lib/tenant';

/**
 * ADDITIVE — dedicated read endpoint for the WhatsApp AI Agent's persisted
 * chat history (Feature 7). Reuses the existing Conversation collection;
 * introduces no new storage. Ownership of the lead is verified against the
 * caller's business before any messages are returned.
 */
export async function GET(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const { leadId } = await params;
    if (!mongoose.isValidObjectId(leadId)) {
      return NextResponse.json({ success: false, error: 'Invalid leadId' }, { status: 400 });
    }

    await dbConnect();
    const lead = await Lead.findOne({ _id: leadId, businessId: new mongoose.Types.ObjectId(ctx.businessId) });
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found or access denied' }, { status: 403 });
    }

    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);

    const messages = await Conversation.find({ leadId }).sort({ timestamp: 1 }).limit(limit).lean();

    return NextResponse.json({ success: true, messages });
  } catch (error: any) {
    console.error('[whatsapp/chat-history/:leadId][GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load chat history' }, { status: 500 });
  }
}
