import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';
import { requireModule } from '@/lib/moduleGating';
import { inngest } from '@/services/inngest/client';
import mongoose from 'mongoose';

const MAX_LEADS_PER_CALL = 200;

/**
 * Mobile contacts import: { leads: [{ name, phone, email? }] }. Each entry is
 * normalized and deduped (against the business's existing leads and within
 * the batch); returns { created, skipped } counts. Only user-selected
 * contacts ever reach this endpoint — the app never uploads a full address
 * book.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    const data = await req.json();
    if (!Array.isArray(data.leads) || data.leads.length === 0) {
      return NextResponse.json({ error: 'leads array is required' }, { status: 400 });
    }
    if (data.leads.length > MAX_LEADS_PER_CALL) {
      return NextResponse.json(
        { error: `A maximum of ${MAX_LEADS_PER_CALL} leads can be imported per call` },
        { status: 400 }
      );
    }

    await dbConnect();
    const businessObjId = new mongoose.Types.ObjectId(ctx.businessId);

    // One fetch of existing phones; dedupe keys compared in JS (stored
    // formats are inconsistent).
    const existing = await Lead.find({ businessId: businessObjId, phone: { $ne: null } })
      .select('phone')
      .lean();
    const seenKeys = new Set(
      existing.map((l: any) => phoneDedupeKey(l.phone)).filter((k): k is string => k !== null)
    );

    let created = 0;
    let skipped = 0;

    for (const raw of data.leads) {
      const phone = normalizePhoneE164(String(raw?.phone ?? ''));
      const key = phone ? phoneDedupeKey(phone) : null;
      if (!phone || !key || seenKeys.has(key)) {
        skipped++;
        continue;
      }
      seenKeys.add(key); // also dedupes within the batch

      const name =
        typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : phone;
      const email =
        typeof raw.email === 'string' && raw.email.trim() ? raw.email.trim() : undefined;

      const lead = await Lead.create({
        tenantId: ctx.organizationId,
        organizationId: ctx.organizationId,
        businessId: businessObjId,
        name,
        phone,
        email,
        source: 'Contacts Import',
        pipelineStage: null,
        lifeCycleStage: 'initial',
      });

      await inngest.send({
        name: 'crm/lead-created',
        data: { leadId: lead._id.toString(), businessId: ctx.businessId.toString() },
      });

      created++;
    }

    return NextResponse.json({ success: true, created, skipped });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
