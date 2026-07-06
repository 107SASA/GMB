import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import mongoose from 'mongoose';
import { requireBusinessContext } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/** All distinct customer groups (tags) for the active business. */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const tags: string[] = await Customer.distinct('tags', {
      businessId: new mongoose.Types.ObjectId(ctx.businessId)
    });
    return NextResponse.json({ success: true, tags: tags.filter(Boolean).sort() });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
