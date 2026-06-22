import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Conversation from '@/models/Conversation';
import ConversationThread from '@/models/ConversationThread';
import Business from '@/models/Business';
import Lead from '@/models/Lead';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalThreads,
      activeThreads,
      aiEnabledThreads,
      messagesToday,
      recentThreadsRaw,
      volumeRaw,
    ] = await Promise.all([
      ConversationThread.countDocuments(),
      ConversationThread.countDocuments({ lastActivityAt: { $gte: twentyFourHoursAgo } }),
      ConversationThread.countDocuments({ aiEnabled: true }),
      Conversation.countDocuments({ direction: 'outbound', createdAt: { $gte: todayStart } }),

      ConversationThread.find()
        .sort({ lastActivityAt: -1 })
        .limit(20)
        .select('businessId leadId aiEnabled unreadCount lastMessage lastActivityAt')
        .lean(),

      Conversation.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              direction: '$direction',
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.date': 1 } },
      ]),
    ]);

    // Populate business names and lead info for recent threads
    const bizIds = [...new Set(recentThreadsRaw.map((t: any) => t.businessId?.toString()))];
    const leadIds = [...new Set(recentThreadsRaw.map((t: any) => t.leadId?.toString()))];

    const [businesses, leads] = await Promise.all([
      Business.find({ _id: { $in: bizIds } }).select('businessName').lean(),
      Lead.find({ _id: { $in: leadIds } }).select('name phone').lean(),
    ]);

    const bizMap: Record<string, string> = {};
    businesses.forEach((b: any) => { bizMap[b._id.toString()] = b.businessName; });
    const leadMap: Record<string, { name: string; phone?: string }> = {};
    leads.forEach((l: any) => { leadMap[l._id.toString()] = { name: l.name, phone: l.phone }; });

    const recentThreads = recentThreadsRaw.map((t: any) => ({
      _id: t._id,
      businessName: bizMap[t.businessId?.toString()] ?? 'Unknown',
      leadName: leadMap[t.leadId?.toString()]?.name ?? 'Unknown',
      leadPhone: leadMap[t.leadId?.toString()]?.phone ?? '',
      aiEnabled: t.aiEnabled,
      unreadCount: t.unreadCount,
      lastMessageSnippet: (t.lastMessage ?? '').slice(0, 80),
      lastActivityAt: t.lastActivityAt,
    }));

    // Build 7-day volume with gaps filled
    const volumeMap: Record<string, { inbound: number; outbound: number }> = {};
    volumeRaw.forEach((row: any) => {
      const date = row._id.date;
      if (!volumeMap[date]) volumeMap[date] = { inbound: 0, outbound: 0 };
      volumeMap[date][row._id.direction as 'inbound' | 'outbound'] = row.count;
    });

    const messageVolume = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      messageVolume.push({
        date: key,
        inbound: volumeMap[key]?.inbound ?? 0,
        outbound: volumeMap[key]?.outbound ?? 0,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalConversations: totalThreads,
          activeThreads,
          aiEnabledThreads,
          messagesToday,
        },
        recentThreads,
        messageVolume,
      },
    });
  } catch (error: any) {
    console.error('WhatsApp Monitor Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch WhatsApp data' },
      { status: 500 }
    );
  }
}
