import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ReviewRequest from '@/models/ReviewRequest';
import Customer from '@/models/Customer';
import Campaign from '@/models/Campaign';
import { sendWhatsApp } from '@/services/whatsapp';
import { sendEmail } from '@/services/email';
import { sendSMS } from '@/services/sms';
import mongoose from 'mongoose';

export async function POST(request: Request) {
  try {
    await dbConnect();
    const { customerId, campaignId, channel = 'WHATSAPP' } = await request.json();

    if (!customerId) return NextResponse.json({ success: false, message: 'Missing customerId' }, { status: 400 });

    const customer = await Customer.findById(customerId).populate('businessId');
    if (!customer) return NextResponse.json({ success: false, message: 'Customer not found' }, { status: 404 });

    const business = customer.businessId as any; // Assuming populated
    if (!business) return NextResponse.json({ success: false, message: 'Business not found for customer' }, { status: 400 });

    const reviewLink = business.reviewLink || process.env.GOOGLE_REVIEW_LINK_BASE || 'https://g.page/r/fallback/review';

    // Create Review Request Record
    const reviewRequest = await ReviewRequest.create({
      customerId: customer._id,
      campaignId: campaignId ? new mongoose.Types.ObjectId(campaignId as string) : undefined,
      channel,
      status: 'QUEUED',
    });

    let sendResult: any = { success: false, error: 'Unknown Channel' };

    const name = customer.firstName || 'Customer';
    const bizName = business.name || 'Our Business';
    const service = customer.service || 'visit';
    const businessId = business._id;

    if (channel === 'WHATSAPP' && customer.phone) {
      sendResult = await sendWhatsApp(businessId.toString(), customer.phone, name, service, reviewLink, bizName);
    } else if (channel === 'EMAIL' && customer.email) {
      sendResult = await sendEmail(customer.email, name, service, reviewLink, bizName, reviewRequest._id.toString());
    } else if (channel === 'SMS' && customer.phone) {
      sendResult = await sendSMS(businessId.toString(), customer.phone, name, service, reviewLink, bizName);
    } else {
      sendResult = { success: false, error: 'Missing contact info for channel' };
    }

    if (sendResult.success) {
      reviewRequest.status = 'SENT';
      reviewRequest.sentAt = new Date();
      await reviewRequest.save();

      if (campaignId) {
        await Campaign.findByIdAndUpdate(campaignId, { $inc: { delivered: 1, totalRequests: 1 } });
      }

      return NextResponse.json({ success: true, request: reviewRequest });
    } else {
      reviewRequest.status = 'FAILED';
      reviewRequest.failReason = sendResult.error;
      reviewRequest.failedAt = new Date();
      await reviewRequest.save();

      return NextResponse.json({ success: false, message: sendResult.error }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
