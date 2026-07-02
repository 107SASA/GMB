import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { inngest } from '@/services/inngest/client';
import mongoose from 'mongoose';

const VALID_SOURCES = ['WhatsApp', 'Website', 'Manual', 'Instagram', 'Facebook', 'Referral', 'Demo Booking', 'Google Business Profile'];
const VALID_STAGES = ['initial', 'active', 'closed', 'converted'];

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

async function parseFile(file: File): Promise<Record<string, any>[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'csv') {
    const text = await file.text();
    return parse(text, { columns: true, skip_empty_lines: true, trim: true });
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }

  throw new Error('Unsupported file type. Please upload a .csv, .xlsx, or .xls file.');
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });

    const rawRows = await parseFile(file);
    if (rawRows.length === 0) return NextResponse.json({ error: 'File is empty or has no data rows.' }, { status: 400 });
    if (rawRows.length > 1000) return NextResponse.json({ error: 'File exceeds the 1,000-row import limit. Please split the file.' }, { status: 400 });

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
