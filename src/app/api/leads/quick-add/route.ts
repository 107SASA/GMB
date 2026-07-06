import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';
import { requireModule } from '@/lib/moduleGating';
import { inngest } from '@/services/inngest/client';
import mongoose from 'mongoose';

const ALLOWED_SOURCES = ['Manual', 'Phone Call', 'Contacts Import'] as const;

/**
 * Mobile lead capture: create a lead from just a phone number (+ optional
 * name). Dedupes by normalized phone within the business — an existing match
 * is returned with { existing: true } instead of creating a duplicate.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    const data = await req.json();
    const phone = normalizePhoneE164(String(data.phone ?? ''));
    if (!phone) {
      return NextResponse.json({ error: 'A valid phone number is required' }, { status: 400 });
    }

    const source = ALLOWED_SOURCES.includes(data.source) ? data.source : 'Manual';
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : phone;

    await dbConnect();
    const businessObjId = new mongoose.Types.ObjectId(ctx.businessId);

    // Stored phones use inconsistent formats, so compare dedupe keys in JS
    // rather than by exact match. Per-business lead counts keep this cheap.
    const key = phoneDedupeKey(phone);
    const candidates = await Lead.find({ businessId: businessObjId, phone: { $ne: null } })
      .select('phone')
      .lean();
    const match = candidates.find((c: any) => phoneDedupeKey(c.phone) === key);

    if (match) {
      const existing = await Lead.findById(match._id).lean();
      return NextResponse.json({ success: true, existing: true, lead: existing });
    }

    const lead = await Lead.create({
      tenantId: ctx.organizationId,
      organizationId: ctx.organizationId,
      businessId: businessObjId,
      name,
      phone,
      source,
      pipelineStage: null,
      lifeCycleStage: 'initial',
    });

    await inngest.send({
      name: 'crm/lead-created',
      data: { leadId: lead._id.toString(), businessId: ctx.businessId.toString() },
    });

    return NextResponse.json({ success: true, existing: false, lead }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
