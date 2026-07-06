import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Campaign from '@/models/Campaign';
import { requireBusinessContext } from '@/lib/tenant';

// Owner-editable campaign settings. Reminder MESSAGES are re-read by the
// Inngest worker at send time, so edits reach in-flight sequences; DELAYS are
// locked in when each sequence starts and apply to newly launched ones only.
const EDITABLE_FIELDS = [
  'name', 'targetTags', 'initialMessage',
  'reminder1Enabled', 'reminder1AfterDays', 'reminder1Message',
  'reminder2Enabled', 'reminder2AfterDays', 'reminder2Message',
  'stopOnReview', 'sendOnlyBizHours', 'bizHoursStart', 'bizHoursEnd',
] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const { id } = await params;
    const body = await request.json();

    const updates: Record<string, any> = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in body) updates[field] = body[field];
    }

    const campaign = await Campaign.findOneAndUpdate(
      { _id: id, businessId: ctx.businessId },
      updates,
      { new: true, runValidators: true }
    );
    if (!campaign) {
      return NextResponse.json({ success: false, message: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, campaign });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const { id } = await params;

    const campaign = await Campaign.findOneAndDelete({ _id: id, businessId: ctx.businessId });
    if (!campaign) {
      return NextResponse.json({ success: false, message: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Campaign deleted' });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
