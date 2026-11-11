import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { normalizePhoneE164 } from '@/lib/phone';
import { createOrUpdateCustomerLead } from '@/services/crm/customerLeads';
import { isOwnCardImageKey } from '@/services/crm/businessCardParse';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, 10);

/**
 * POST /api/leads/business-card — saves the visiting-card form the owner
 * reviewed (after /scan). Source "Business Card"; dedupes by phone/email in
 * this workspace — an existing lead gets the missing details filled in and is
 * returned with { existing: true }.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent', ctx.businessId);
    if (!gate.ok) return gate.response;

    const data = await req.json().catch(() => ({}));

    const rawPhone = str(data.phone, 40);
    const phone = rawPhone ? normalizePhoneE164(rawPhone) : null;
    if (rawPhone && !phone) {
      return NextResponse.json({ error: 'The phone number looks incomplete. Use a 10-digit number or +country format.' }, { status: 400 });
    }
    const email = str(data.email, 200).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'The email address looks wrong.' }, { status: 400 });
    }
    const name = str(data.name, 120);
    if (!name && !phone && !email) {
      return NextResponse.json({ error: 'Add at least a name, phone number or email.' }, { status: 400 });
    }

    let valuation: number | null = null;
    if (data.valuation !== undefined && data.valuation !== null && data.valuation !== '') {
      const n = Number(data.valuation);
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'Valuation must be a non-negative number.' }, { status: 400 });
      valuation = n;
    }

    const otherPhones = strList(data.otherPhones, 40)
      .map((p) => normalizePhoneE164(p) ?? p)
      .filter((p) => p !== phone);
    const otherEmails = strList(data.otherEmails, 200).map((e) => e.toLowerCase()).filter((e) => e !== email);
    const imageKeys = (Array.isArray(data.imageKeys) ? data.imageKeys : []).filter((k: unknown) => isOwnCardImageKey(k, ctx.businessId)).slice(0, 2);
    const metAt = str(data.metAt, 200);
    const notes = str(data.notes, 2000);
    const company = str(data.company, 200);

    await dbConnect();
    const r = await createOrUpdateCustomerLead({
      businessId: ctx.businessId,
      organizationId: ctx.organizationId,
      name: name || null,
      phone,
      email: email || null,
      source: 'Business Card',
      notes: notes || null,
      valuation,
      city: str(data.city, 100) || null,
      tags: metAt ? [metAt.slice(0, 60)] : undefined,
      businessCard: {
        company,
        designation: str(data.designation, 200),
        website: str(data.website, 300),
        address: str(data.address, 500),
        otherPhones,
        otherEmails,
        metAt,
        imageKeys,
      },
      createdBy: ctx.userId,
      activity: {
        type: 'note',
        content: [
          `Visiting card scanned${metAt ? ` — met at ${metAt}` : ''}${company ? ` (${company})` : ''}.`,
          notes,
        ].filter(Boolean).join('\n'),
        createdBy: ctx.userId,
      },
    });
    if (!r.lead) return NextResponse.json({ error: r.skippedReason }, { status: 400 });

    return NextResponse.json({ success: true, existing: !r.created, lead: r.lead }, { status: r.created ? 201 : 200 });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
