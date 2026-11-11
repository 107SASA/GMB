import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { ImportError, MAX_ROWS, parseSpreadsheet } from '@/lib/spreadsheetImport';
import { requireWorkspacePlan } from '@/lib/planGate';

export const dynamic = 'force-dynamic';

/**
 * Reads an uploaded Excel (.xlsx) or CSV for the review-customer import
 * preview — the same bounded reader the CRM import uses (5 MB, 1000 rows,
 * file checked by content not MIME type). Saves nothing; the preview then
 * posts the chosen rows to /api/campaigns/import.
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  // Paid feature: this workspace needs its own plan (lib/planGate.ts).
  const planGate = await requireWorkspacePlan(ctx.userId, ctx.businessId);
  if (!planGate.ok) return planGate.response;
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ success: false, message: 'Choose a file to upload.' }, { status: 400 });
    const rows = await parseSpreadsheet(file);
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ success: false, message: `This file has ${rows.length} rows. Please upload at most ${MAX_ROWS} at a time.` }, { status: 400 });
    }
    return NextResponse.json({ success: true, rows });
  } catch (err: any) {
    const message = err instanceof ImportError ? err.message : 'Could not read the file. Please check it and try again.';
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
