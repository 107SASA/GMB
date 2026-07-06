import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import { requireBusinessContext } from '@/lib/tenant';

/** Owner edits to a customer: groups (tags), opt-out, service info. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const { id } = await params;
    const body = await request.json();

    const updates: Record<string, any> = {};
    if ('tags' in body) {
      updates.tags = Array.isArray(body.tags)
        ? body.tags.map((t: string) => String(t).trim()).filter(Boolean)
        : [];
    }
    if ('optedOut' in body) updates.optedOut = Boolean(body.optedOut);
    if ('service' in body) updates.service = body.service;
    if ('notes' in body) updates.notes = body.notes;

    const customer = await Customer.findOneAndUpdate(
      { _id: id, businessId: ctx.businessId },
      updates,
      { new: true, runValidators: true }
    );
    if (!customer) {
      return NextResponse.json({ success: false, message: 'Customer not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, customer });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
