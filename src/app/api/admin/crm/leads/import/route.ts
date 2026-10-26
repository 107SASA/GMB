import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { ImportError, MAX_ROWS, parseSpreadsheet } from '@/lib/spreadsheetImport';
import { importPlatformLeads } from '@/services/admin/platformCrm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/crm/leads/import — multipart `file` (.csv / .xlsx, up to
 * 1,000 rows, 5 MB) and optional `updateStages=true`. Columns: see
 * CRM_CSV_TEMPLATE (lib/admin/platformCrm.ts).
 */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: 'No file uploaded.' }, { status: 400 });
    let rows: Record<string, unknown>[];
    try {
      rows = await parseSpreadsheet(file);
    } catch (err: any) {
      if (err instanceof ImportError) return NextResponse.json({ success: false, error: err.message }, { status: 400 });
      throw err;
    }
    if (!rows.length) return NextResponse.json({ success: false, error: 'The file has no data rows.' }, { status: 400 });
    if (rows.length > MAX_ROWS) return NextResponse.json({ success: false, error: `The file has more than ${MAX_ROWS.toLocaleString()} rows. Please split it.` }, { status: 400 });
    const summary = await importPlatformLeads(rows, auth.userId, { updateStages: form.get('updateStages') === 'true' });
    return NextResponse.json({ success: true, ...summary });
  } catch (error: any) {
    console.error('[admin/crm/leads/import] POST failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
