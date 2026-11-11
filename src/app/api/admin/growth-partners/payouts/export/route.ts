import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { csvField } from '@/lib/admin/platformCrm';
import { adminPayoutList } from '@/services/partners/partnerCommissions';

/** Payout history as CSV for accounts. */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const rows = await adminPayoutList();
    const header = ['Paid on', 'Partner', 'Code', 'Gross (INR)', 'TDS %', 'TDS (INR)', 'Net (INR)', 'Method', 'Reference (UTR)', 'Account', 'IFSC', 'Commissions', 'Note'];
    const lines = rows.map((p) =>
      [
        new Date(p.paidAt).toISOString().slice(0, 10),
        p.partnerName,
        p.partnerCode ?? '',
        p.grossAmount,
        p.tdsPercent,
        p.tdsAmount,
        p.netAmount,
        p.method,
        p.reference,
        p.bank?.accountLast4 ? `XXXX${p.bank.accountLast4}` : '',
        p.bank?.ifsc ?? '',
        p.count,
        p.note ?? '',
      ].map(csvField).join(',')
    );
    const csv = `﻿${[header.map(csvField).join(','), ...lines].join('\r\n')}`;
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="partner-payouts-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: any) {
    console.error('[admin/growth-partners/payouts/export] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Export failed' }, { status: 500 });
  }
}
