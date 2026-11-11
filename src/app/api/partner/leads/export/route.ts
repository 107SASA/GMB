import { NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { csvField } from '@/lib/admin/platformCrm';
import { listPartnerLeads } from '@/services/partners/partnerLeads';

/** The partner's leads as a CSV download. */
export async function GET() {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    const rows = await listPartnerLeads(String(auth.partner._id));
    const header = ['Name', 'Business', 'Phone', 'Email', 'City', 'Stage', 'Deal value (INR)', 'Tags', 'Added on'];
    const lines = rows.map((r) =>
      [
        r.contactName ?? r.name,
        r.business ?? '',
        r.phone ?? '',
        r.email ?? '',
        r.city ?? '',
        r.stageLabel,
        r.dealValue ?? '',
        (r.tags ?? []).join('; '),
        r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '',
      ].map(csvField).join(',')
    );
    const csv = `﻿${[header.map(csvField).join(','), ...lines].join('\r\n')}`;
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="my-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: any) {
    console.error('[partner/leads/export] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Export failed' }, { status: 500 });
  }
}
