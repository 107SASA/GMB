import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import ReviewRequest from '@/models/ReviewRequest';
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

/**
 * Deletes a customer entirely, including their review-request history —
 * this is the "start over" button: re-adding the same phone number afterward
 * creates a brand-new Customer document, so the campaign-launch dedupe check
 * (which keys off customerId) doesn't see any prior "Active" request and a
 * fresh review request can be sent right away, without waiting for the old
 * one's reminder sequence to finish. Wiping the old ReviewRequest rows too
 * avoids leaving orphaned history pointing at a customerId that no longer
 * exists.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const { id } = await params;

    const customer = await Customer.findOneAndDelete({ _id: id, businessId: ctx.businessId });
    if (!customer) {
      return NextResponse.json({ success: false, message: 'Customer not found' }, { status: 404 });
    }

    await ReviewRequest.deleteMany({ customerId: id, businessId: ctx.businessId });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
