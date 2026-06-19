import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Business from '@/models/Business';
import { DEV_CONTEXT } from '@/lib/dev-context';

// GET - fetch kanban columns for a business
export async function GET(req: NextRequest) {
  try {
    await connectDB();
    const businessId = DEV_CONTEXT.businessId;
    const business = await Business.findById(businessId).select('kanbanColumns');
    if (!business) {
      // Business doesn't exist yet, return empty columns
      return NextResponse.json({ success: true, kanbanColumns: [] });
    }
    return NextResponse.json({ success: true, kanbanColumns: business.kanbanColumns || [] });
  } catch (error) {
    console.error('GET kanban-columns error:', error);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}

// PATCH - save kanban columns for a business
export async function PATCH(req: NextRequest) {
  try {
    await connectDB();
    const businessId = DEV_CONTEXT.businessId;
    const { kanbanColumns } = await req.json();

    if (!Array.isArray(kanbanColumns)) {
      return NextResponse.json({ success: false, message: 'kanbanColumns must be an array' }, { status: 400 });
    }

    // upsert: update if exists, create if not
    await Business.findByIdAndUpdate(
      businessId,
      { kanbanColumns },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return NextResponse.json({ success: true, kanbanColumns });
  } catch (error) {
    console.error('PATCH kanban-columns error:', error);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}