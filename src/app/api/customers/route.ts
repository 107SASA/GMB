import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import mongoose from 'mongoose';
import { requireBusinessContext } from '@/lib/tenant';
import { normalizePhoneE164 } from '@/lib/phone';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || 'all';
    const optedOut = searchParams.get('optedOut');
    const tag = searchParams.get('tag');

    const baseMatch: any = { businessId: new mongoose.Types.ObjectId(ctx.businessId) };

    if (search) {
      baseMatch.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (status !== 'all') {
      baseMatch.reviewStatus = status;
    }
    if (optedOut === 'false') {
      baseMatch.optedOut = false;
    }
    if (tag) {
      baseMatch.tags = tag;
    }

    const [customers, total, statsResult] = await Promise.all([
      Customer.find(baseMatch)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Customer.countDocuments(baseMatch),
      // Stats always scoped to full business (not filtered) so the cards stay accurate
      Customer.aggregate([
        { $match: { businessId: new mongoose.Types.ObjectId(ctx.businessId) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            pending: { $sum: { $cond: [{ $eq: ['$reviewStatus', 'Pending'] }, 1, 0] } },
            requested: { $sum: { $cond: [{ $eq: ['$reviewStatus', 'Requested'] }, 1, 0] } },
            completed: { $sum: { $cond: [{ $eq: ['$reviewStatus', 'Completed'] }, 1, 0] } },
            optedOut: { $sum: { $cond: ['$optedOut', 1, 0] } }
          }
        }
      ])
    ]);

    const stats = statsResult[0] ?? { total: 0, pending: 0, requested: 0, completed: 0, optedOut: 0 };

    return NextResponse.json({
      success: true,
      customers,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      stats
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

/** Add a single customer manually (WhatsApp review requests need a phone). */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const body = await req.json();

    const name = String(body.name ?? '').trim();
    if (!name) {
      return NextResponse.json({ success: false, message: 'Customer name is required' }, { status: 400 });
    }

    const phone = normalizePhoneE164(String(body.phone ?? ''));
    if (!phone) {
      return NextResponse.json(
        { success: false, message: 'A valid phone number is required (e.g. +919876543210 or 9876543210)' },
        { status: 400 }
      );
    }

    const existing = await Customer.findOne({ businessId: ctx.businessId, phone });
    if (existing) {
      return NextResponse.json({ success: false, message: 'A customer with this phone number already exists' }, { status: 409 });
    }

    const customer = await Customer.create({
      tenantId: ctx.organizationId,
      businessId: ctx.businessId,
      name,
      phone,
      email: body.email?.trim() || undefined,
      service: body.service?.trim() || undefined,
      serviceDate: body.serviceDate ? new Date(body.serviceDate) : undefined,
      tags: Array.isArray(body.tags) ? body.tags.map((t: string) => String(t).trim()).filter(Boolean) : [],
    });

    return NextResponse.json({ success: true, customer }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
