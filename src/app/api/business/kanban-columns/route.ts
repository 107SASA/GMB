import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';

export async function GET(_req: NextRequest) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await connectDB();
    const business = await Business.findById(ctx.businessId).select('kanbanColumns');
    if (!business) {
      return NextResponse.json({ success: true, kanbanColumns: [] });
    }
    return NextResponse.json({ success: true, kanbanColumns: business.kanbanColumns || [] });
  } catch (error) {
    console.error('GET kanban-columns error:', error);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await connectDB();
    const { kanbanColumns } = await req.json();

    if (!Array.isArray(kanbanColumns)) {
      return NextResponse.json({ success: false, message: 'kanbanColumns must be an array' }, { status: 400 });
    }

    await Business.findByIdAndUpdate(
      ctx.businessId,
      { kanbanColumns },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return NextResponse.json({ success: true, kanbanColumns });
  } catch (error) {
    console.error('PATCH kanban-columns error:', error);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}
