import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { inngest } from '@/services/inngest/client';
import mongoose from 'mongoose';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const runtime = 'nodejs';

const VALID_SOURCES = ['WhatsApp', 'Website', 'Manual', 'Instagram', 'Facebook', 'Referral', 'Demo Booking', 'Google Business Profile'];
const VALID_STAGES = ['initial', 'active', 'closed', 'converted'];

// SEC-13 / SEC-8 — bound the upload and don't trust the browser MIME type.
const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 1000;

/** exceljs cell values can be strings, numbers, Dates, or rich objects
 *  (hyperlink / formula / richText) — flatten every shape to a trimmed string. */
function cellToString(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text.trim();
    if ('result' in v) return cellToString(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => t?.text ?? '').join('').trim();
    if (typeof v.hyperlink === 'string') return v.hyperlink.trim();
  }
  return String(v).trim();
}

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

class ImportError extends Error {}

async function parseFile(file: File): Promise<Record<string, any>[]> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ImportError('File is larger than 5 MB. Please split it into smaller files.');
  }

  const ext = file.name.split('.').pop()?.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (ext === 'csv') {
    try {
      return parse(buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
    } catch {
      throw new ImportError('Could not parse the file as CSV. Please check the format.');
    }
  }

  if (ext === 'xls') {
    // Legacy Excel 2003 (BIFF) is no longer supported — exceljs reads .xlsx
    // only, and the old `xlsx` package it replaced (Sep 2026) carried an
    // unfixed prototype-pollution / ReDoS advisory.
    throw new ImportError('Legacy .xls files are not supported. Please re-save as .xlsx or export to .csv.');
  }

  if (ext === 'xlsx') {
    // Magic bytes: a real .xlsx is a ZIP container — "PK\x03\x04".
    if (!(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
      throw new ImportError('This does not look like a valid .xlsx file.');
    }
    const wb = new ExcelJS.Workbook();
    try {
      // exceljs accepts Buffer/ArrayBuffer/Uint8Array at runtime; the typing
      // is narrower than @types/node's Buffer generic.
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new ImportError('Could not read the spreadsheet. Please check the file and try again.');
    }
    const sheet = wb.worksheets[0];
    if (!sheet) throw new ImportError('The spreadsheet has no worksheets.');

    // First non-empty row = headers.
    const rows: Record<string, any>[] = [];
    let headers: string[] | null = null;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as any[]) ?? [];
      // exceljs row.values is 1-indexed (values[0] is undefined).
      const cells = values.slice(1).map(cellToString);
      if (!headers) {
        headers = cells.map((h, i) => (h ? h : `column_${i + 1}`));
        return;
      }
      if (cells.every((c) => c === '')) return; // skip fully-empty rows
      const obj: Record<string, any> = {};
      headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
      rows.push(obj);
    });
    return rows;
  }

  throw new ImportError('Unsupported file type. Please upload a .csv or .xlsx file.');
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
    const businessObjId = new mongoose.Types.ObjectId(ctx.businessId);

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

        // Normalise source
        const source = VALID_SOURCES.find(s => s.toLowerCase() === row.source.toLowerCase()) || 'Manual';

        // Normalise lifeCycleStage
        const lifeCycleStage = VALID_STAGES.includes(row.lifeCycleStage.toLowerCase())
          ? row.lifeCycleStage.toLowerCase()
          : 'initial';

        // Deduplicate within file
        const dedupeKey = row.phone || row.email;
        if (dedupeKey && seenKeys.has(dedupeKey)) {
          errors.push(`Row ${rowNum}: Duplicate entry for "${dedupeKey}" — skipped.`);
          skipped++;
          continue;
        }
        if (dedupeKey) seenKeys.add(dedupeKey);

        // Check if lead already exists in this business
        const existsQuery: Record<string, any> = { businessId: businessObjId };
        if (row.phone) existsQuery.phone = row.phone;
        else if (row.email) existsQuery.email = row.email;

        if (row.phone || row.email) {
          const exists = await Lead.exists(existsQuery);
          if (exists) {
            errors.push(`Row ${rowNum}: Lead "${row.name}" (${row.phone || row.email}) already exists — skipped.`);
            skipped++;
            continue;
          }
        }

        const tags = row.tags ? row.tags.split(/[,;|]/).map((t: string) => t.trim()).filter(Boolean) : [];

        const lead = await Lead.create({
          tenantId: ctx.organizationId,
          organizationId: ctx.organizationId,
          businessId: businessObjId,
          name: row.name,
          phone: row.phone || undefined,
          email: row.email || undefined,
          source,
          interest: row.interest || undefined,
          notes: row.notes || undefined,
          lifeCycleStage,
          tags,
          pipelineStage: null,
        });

        await inngest.send({
          name: 'crm/lead-created',
          data: { leadId: lead._id.toString(), businessId: ctx.businessId.toString() },
        });

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
