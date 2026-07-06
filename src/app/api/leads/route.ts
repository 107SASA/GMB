import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const minIntentScore = searchParams.get('minIntentScore');
    const qualificationStatus = searchParams.get('qualificationStatus');

    const query: any = { businessId: ctx.businessId };
    if (status) query.status = status;
    if (minIntentScore) query.intentScore = { $gte: Number(minIntentScore) };
    if (qualificationStatus) query.qualificationStatus = qualificationStatus;

    const leads = await Lead.find(query).sort({ updatedAt: -1 });
    return NextResponse.json(leads);
  } catch (error) {
    console.error('Error fetching leads:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
