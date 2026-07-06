import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { phoneDedupeKey } from '@/lib/phone';
import { requireModule } from '@/lib/moduleGating';
import { inngest } from '@/services/inngest/client';
import mongoose from 'mongoose';

export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    await dbConnect();

    let leads = await Lead.find({
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    })
      .sort({ createdAt: -1 })
      .lean();

    // ?phone= — "does this number already exist" lookups from mobile.
    // Stored phones use inconsistent formats, so match by dedupe key.
    const phoneParam = new URL(req.url).searchParams.get('phone');
    if (phoneParam) {
      const key = phoneDedupeKey(phoneParam);
      leads = key ? leads.filter((l: any) => phoneDedupeKey(l.phone) === key) : [];
    }

    return NextResponse.json({ success: true, leads });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

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
