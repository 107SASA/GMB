import { NextRequest, NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import dbConnect from "@/lib/mongodb";
import Customer from "@/models/Customer";

export async function POST(req: NextRequest) {
  try {
    await dbConnect();

    const formData = await req.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const csvData = await file.text();
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
    }) as Record<string, any>[];

    let newCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];

    for (const record of records) {
      try {
        const phone = record.phone?.trim();
        if (!phone) {
          errors.push(`Row missing phone number: ${JSON.stringify(record)}`);
          continue;
        }

        const customerData = {
          firstName: record.name?.split(' ')[0] || record.firstName || 'Customer',
          lastName: record.name?.split(' ').slice(1).join(' ') || record.lastName || '',
          email: record.email || '',
          lastVisit: record.lastVisit ? new Date(record.lastVisit) : new Date(),
          totalSpent: parseFloat(record.totalSpent) || 0,
          optIn: true
        };

        const existing = await Customer.findOne({ phone });

        if (existing) {
          // Deduplication: Update metrics for existing customer
          existing.lastVisit = customerData.lastVisit > existing.lastVisit ? customerData.lastVisit : existing.lastVisit;
          existing.totalSpent += customerData.totalSpent;
          if (customerData.firstName && existing.firstName === 'Customer') {
            existing.firstName = customerData.firstName;
            existing.lastName = customerData.lastName;
          }
          await existing.save();
          updatedCount++;
        } else {
          await Customer.create({
            phone,
            ...customerData
          });
          newCount++;
        }
      } catch (err: any) {
        errors.push(`Error parsing row ${JSON.stringify(record)}: ${err.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${records.length} customers. ${newCount} inserted, ${updatedCount} updated.`,
      errors
    });
  } catch (error: any) {
    console.error("Upload API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
