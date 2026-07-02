import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { inngest } from '@/services/inngest/client';
import mongoose from 'mongoose';

export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const leads = await Lead.find({
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ success: true, leads });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const data = await req.json();
    await dbConnect();

    const lead = await Lead.create({
      tenantId: ctx.organizationId,
      organizationId: ctx.organizationId,
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
      name: data.name,
      phone: data.phone,
      email: data.email,
      source: data.source || 'Manual',
      pipelineStage: null,
      notes: data.notes,
      interest: data.interest,
      lifeCycleStage: data.lifeCycleStage || 'initial',
    });

    await inngest.send({
      name: 'crm/lead-created',
      data: { leadId: lead._id.toString(), businessId: ctx.businessId.toString() },
    });

    return NextResponse.json({ success: true, lead }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
