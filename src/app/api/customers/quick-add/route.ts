import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import { requireBusinessContext } from '@/lib/tenant';
import { normalizePhoneE164 } from '@/lib/phone';
import { inngest } from '@/services/inngest/client';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * Mobile "Add Customer" quick-add: create (or reuse) a Customer from just a
 * phone number and immediately fire a one-off WhatsApp review request —
 * the same `campaigns/review.request.start` event / processReviewCampaign
 * Inngest function (services/inngest/functions.ts) that a full campaign
 * launch uses (api/campaigns/[id]/launch) and that the existing single-
 * customer "Send Review Request" button already uses (api/campaigns/send).
 * Omitting campaignId makes processReviewCampaign fall back to the
 * campaign-default message/reminder settings, exactly like that button.
 *
 * This intentionally targets the Customer model (review-request audience),
 * not Lead (api/leads/quick-add, CRM/sales-pipeline) — those are different
 * features. Before this route existed, the mobile "Add Customer" card
 * called the Lead endpoint, which only created a CRM lead and queued a
 * generic sales-nurture WhatsApp drip starting 24h later; nothing sent an
 * actual review request. The CRM "Add lead" screen and contact-import flow
 * still use the Lead endpoint unchanged — this route is additive.
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const data = await req.json();

    const phone = normalizePhoneE164(String(data.phone ?? ''));
    if (!phone) {
      return NextResponse.json({ error: 'A valid phone number is required' }, { status: 400 });
    }
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : phone;

    let customer = await Customer.findOne({ businessId: ctx.businessId, phone });
    const existing = !!customer;
    if (!customer) {
      customer = await Customer.create({
        tenantId: ctx.organizationId,
        businessId: ctx.businessId,
        name,
        phone,
        service: typeof data.service === 'string' && data.service.trim() ? data.service.trim() : undefined,
      });
    }

    if (customer.optedOut) {
      return NextResponse.json(
        {
          success: true,
          existing,
          customer,
          reviewRequestSent: false,
          reason: 'This customer previously opted out of messages.',
        },
        { status: 200 }
      );
    }
    if (!customer.phone) {
      // Unreachable in practice (phone is required above), kept for parity
      // with /api/campaigns/send's own guard.
      return NextResponse.json(
        { success: true, existing, customer, reviewRequestSent: false, reason: 'No phone number on file.' },
        { status: 200 }
      );
    }

    await inngest.send({
      name: 'campaigns/review.request.start',
      data: {
        customerId: customer._id.toString(),
        businessId: ctx.businessId.toString(),
        tenantId: ctx.organizationId,
      },
    });
    customer.reviewStatus = 'Requested';
    await customer.save();

    return NextResponse.json(
      { success: true, existing, customer, reviewRequestSent: true },
      { status: existing ? 200 : 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
