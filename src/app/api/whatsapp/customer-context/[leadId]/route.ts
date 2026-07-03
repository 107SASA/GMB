import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import mongoose from 'mongoose';
import Lead from '@/models/Lead';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';
import { buildCustomerContext } from '@/services/whatsapp-agent/customerContextService';
import { resolveWorkingHoursConfig } from '@/services/whatsapp-agent/businessHours';

/**
 * ADDITIVE — powers the "Customer Insights" panel in the WhatsApp inbox UI.
 * Read-only: wraps buildCustomerContext() (Feature 9/10) plus whether
 * booking is enabled for this business, so the UI can explain why an
 * appointment section is/isn't showing.
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
    const lead = await Lead.findOne({ _id: leadId, businessId: new mongoose.Types.ObjectId(ctx.businessId) }).lean();
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found or access denied' }, { status: 403 });
    }

    const business = await Business.findById(ctx.businessId).select('whatsappBookingSettings').lean();
    const bookingConfig = resolveWorkingHoursConfig((business as any)?.whatsappBookingSettings);

    const context = await buildCustomerContext({
      leadId,
      businessId: ctx.businessId,
      phone: (lead as any).phone,
    });

    return NextResponse.json({ success: true, context, bookingEnabled: bookingConfig.bookingEnabled });
  } catch (error: any) {
    console.error('[whatsapp/customer-context/:leadId][GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load customer context' }, { status: 500 });
  }
}
