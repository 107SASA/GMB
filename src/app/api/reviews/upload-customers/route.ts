import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import { parse } from 'csv-parse/sync';

export async function POST(request: Request) {
  try {
    await dbConnect();
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const businessId = formData.get('businessId') as string;

    if (!file || !businessId) {
      return NextResponse.json({ success: false, message: 'Missing file or businessId' }, { status: 400 });
    }

    const fileContent = await file.text();
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    let added = 0;
    let duplicates = 0;

    for (const record of records as any[]) {
      // Basic normalization
      const phone = record.phone ? record.phone.replace(/\D/g, '') : null;
      const email = record.email ? record.email.toLowerCase().trim() : null;

      if (!phone && !email) continue; // skip invalid rows

      // Duplicate check (naive check on phone or email for the same business)
      const existing = await Customer.findOne({
        businessId,
        $or: [
          { phone: phone || '---' },
          { email: email || '---' }
        ]
      });

      if (existing) {
        duplicates++;
      } else {
        await Customer.create({
          businessId,
          firstName: record.firstName || record.name || 'Customer',
          lastName: record.lastName || '',
          phone,
          email,
          service: record.service || '',
          source: 'CSV',
          channel: phone ? 'WHATSAPP' : 'EMAIL',
        });
        added++;
      }
    }

    return NextResponse.json({ success: true, added, duplicates, total: records.length });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
