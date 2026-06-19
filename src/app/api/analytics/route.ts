import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import Conversation from '@/models/Conversation';
import Appointment from '@/models/Appointment';

export async function GET(req: NextRequest) {
  try {
    await dbConnect();

    const totalLeads = await Lead.countDocuments();
    const convertedLeads = await Lead.countDocuments({ status: 'Converted' });
    const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;
    
    const aiResponseCount = await Conversation.countDocuments({ aiGenerated: true });
    
    // Group leads by source
    const sourcesAgg = await Lead.aggregate([
      { $group: { _id: "$source", count: { $sum: 1 } } }
    ]);
    const leadSources = sourcesAgg.map(s => ({ name: s._id || 'Unknown', value: s.count }));

    // Leads by status
    const statusesAgg = await Lead.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    const leadsByStatus = statusesAgg.map(s => ({ name: s._id, value: s.count }));

    // NEW: Qualification Funnel
    const qualificationAgg = await Lead.aggregate([
      { $group: { _id: "$qualificationStatus", count: { $sum: 1 } } }
    ]);
    const qualificationFunnel = qualificationAgg.map(q => ({ name: q._id || 'Unqualified', value: q.count }));

    // NEW: Urgency Breakdown
    const urgencyAgg = await Lead.aggregate([
      { $group: { _id: "$urgency", count: { $sum: 1 } } }
    ]);
    const urgencyBreakdown = urgencyAgg.map(u => ({ name: u._id || 'None', value: u.count }));

    // NEW: Bookings Info
    const totalAppointments = await Appointment.countDocuments();
    const completedAppointments = await Appointment.countDocuments({ status: 'Completed' });
    const bookingSuccessRate = totalAppointments > 0 ? (completedAppointments / totalAppointments) * 100 : 0;

    return NextResponse.json({
      totalLeads,
      conversionRate: conversionRate.toFixed(1),
      leadSources,
      aiResponseCount,
      leadsByStatus,
      qualificationFunnel,
      urgencyBreakdown,
      bookingSuccessRate: bookingSuccessRate.toFixed(1)
    });

  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
