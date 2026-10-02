import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { normalizePhoneE164 } from '@/lib/phone';
import { requireModule } from '@/lib/moduleGating';
import { createOrUpdateCustomerLead } from '@/services/crm/customerLeads';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

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

    // Optional — validated here (not just trusted from the client) since
    // it's a plain number field with no dropdown to constrain it. Same rule
    // as the web Add Lead form's /api/crm/leads.
    let valuation: number | undefined;
    if (data.valuation !== undefined && data.valuation !== null && data.valuation !== '') {
      const n = Number(data.valuation);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: 'Valuation must be a non-negative number.' }, { status: 400 });
      }
      valuation = n;
    }

    await dbConnect();
    // Canonical Customer CRM path (normalized phone dedupe inside this
    // workspace; an existing lead is returned, never duplicated).
    const r = await createOrUpdateCustomerLead({
      businessId: ctx.businessId,
      organizationId: ctx.organizationId,
      name,
      phone,
      source,
      valuation: valuation ?? null,
      createdBy: ctx.userId,
    });
    if (!r.lead) return NextResponse.json({ error: r.skippedReason }, { status: 400 });

    return NextResponse.json({ success: true, existing: !r.created, lead: r.lead }, { status: r.created ? 201 : 200 });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
