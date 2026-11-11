import { NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { ImportError, MAX_ROWS, parseSpreadsheet } from '@/lib/spreadsheetImport';
import { importPartnerLeads } from '@/services/partners/partnerLeads';

export const runtime = 'nodejs';

/** Import leads from a .csv / .xlsx (same columns as the admin CRM template). */
export async function POST(req: Request) {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;

  const rate = await checkDurableRateLimit(`partner-import:${String(auth.partner._id)}`, 10, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: 'Too many imports. Please try again in an hour.' }, { status: 429 });
  }

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: 'Choose a file.' }, { status: 400 });
    let rows: Record<string, unknown>[];
    try {
      rows = await parseSpreadsheet(file);
    } catch (err) {
      if (err instanceof ImportError) return NextResponse.json({ success: false, error: err.message }, { status: 400 });
      throw err;
    }
    if (!rows.length) return NextResponse.json({ success: false, error: 'The file has no data rows.' }, { status: 400 });
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ success: false, error: `The file has more than ${MAX_ROWS.toLocaleString()} rows. Please split it.` }, { status: 400 });
    }
    const summary = await importPartnerLeads(auth.partner, auth.userId, rows);
    return NextResponse.json({ success: true, data: summary });
  } catch (error: any) {
    console.error('[partner/leads/import] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Import failed. Please check the file and try again.' }, { status: 500 });
  }
}
