import { NextRequest, NextResponse } from 'next/server';
import { ImportError, MAX_ROWS, parseSpreadsheet as parseFile } from '@/lib/spreadsheetImport';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { phoneDedupeKey } from '@/lib/phone';
import { buildCustomerLeadIndex, createOrUpdateCustomerLead } from '@/services/crm/customerLeads';
import { canonicalSource } from '@/services/crm/sources';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const runtime = 'nodejs';

// 'converted' is not importable: a Won lead needs a real deal value, so such
// rows land in Open and the owner records the deal from the CRM.
const VALID_STAGES = ['initial', 'active', 'closed'];

// File reading (size/row limits, CSV + .xlsx) is shared: lib/spreadsheetImport.ts.

function normaliseRow(raw: Record<string, any>) {
  // Accept flexible column names (case-insensitive, with/without spaces)
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const found = Object.keys(raw).find(r => r.trim().toLowerCase() === k.toLowerCase());
      if (found && raw[found] !== undefined && String(raw[found]).trim() !== '') {
        return String(raw[found]).trim();
      }
    }
    return '';
  };

  return {
    name: get('name', 'full name', 'fullname', 'lead name'),
    phone: get('phone', 'mobile', 'phone number', 'mobile number', 'contact'),
    email: get('email', 'email address', 'e-mail'),
    source: get('source', 'lead source'),
    interest: get('interest', 'course', 'service', 'product'),
    notes: get('notes', 'note', 'comments', 'description'),
    lifeCycleStage: get('lifecyclestage', 'lifecycle stage', 'life cycle stage', 'stage'),
    tags: get('tags', 'tag'),
  };
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });

    let rawRows: Record<string, any>[];
    try {
      rawRows = await parseFile(file);
    } catch (err: any) {
      if (err instanceof ImportError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    if (rawRows.length === 0) return NextResponse.json({ error: 'File is empty or has no data rows.' }, { status: 400 });
    if (rawRows.length > MAX_ROWS) return NextResponse.json({ error: `File exceeds the ${MAX_ROWS.toLocaleString()}-row import limit. Please split the file.` }, { status: 400 });

    await dbConnect();
    // One lookup of this workspace's phones/emails for the whole file (not a
    // scan per row); kept current as rows are created.
    const index = await buildCustomerLeadIndex(ctx.businessId);

    // Deduplicate within the file by phone/email
    const seenKeys = new Set<string>();

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const rowNum = i + 2; // 1-based + header row
      try {
        const row = normaliseRow(rawRows[i]);

        if (!row.name) {
          errors.push(`Row ${rowNum}: Missing required field "name".`);
          skipped++;
          continue;
        }

        // A recognised source column wins; anything else is a CSV import.
        const source = row.source ? canonicalSource(row.source, 'CSV Import') : 'CSV Import';

        const stageIn = row.lifeCycleStage.toLowerCase();
        const lifeCycleStage = (VALID_STAGES.includes(stageIn) ? stageIn : 'initial') as 'initial' | 'active' | 'closed';
        if (stageIn === 'converted') {
          errors.push(`Row ${rowNum}: imported as Open — record the deal value in the CRM to mark it Won.`);
        }

        // Deduplicate within the file (phone by dedupe key, so formats match).
        const dedupeKey = (row.phone && phoneDedupeKey(row.phone)) || row.email.toLowerCase();
        if (dedupeKey && seenKeys.has(dedupeKey)) {
          errors.push(`Row ${rowNum}: Duplicate entry for "${row.phone || row.email}" — skipped.`);
          skipped++;
          continue;
        }
        if (dedupeKey) seenKeys.add(dedupeKey);

        const tags = row.tags ? row.tags.split(/[,;|]/).map((t: string) => t.trim()).filter(Boolean) : [];

        // Canonical Customer CRM path: an existing lead in this workspace (same
        // phone in any format, or email) is skipped; imported rows are never messaged.
        const r = await createOrUpdateCustomerLead({
          businessId: ctx.businessId,
          organizationId: ctx.organizationId,
          name: row.name,
          phone: row.phone || null,
          email: row.email || null,
          source,
          interest: row.interest || null,
          notes: row.notes || null,
          lifeCycleStage,
          tags,
          createdBy: ctx.userId,
          bulk: true,
        }, { index });
        if (!r.created) {
          errors.push(`Row ${rowNum}: Lead "${row.name}" (${row.phone || row.email}) already exists — skipped.`);
          skipped++;
          continue;
        }

        created++;
      } catch (err: any) {
        errors.push(`Row ${rowNum}: ${err.message}`);
        skipped++;
      }
    }

    return NextResponse.json({ success: true, created, skipped, errors });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
