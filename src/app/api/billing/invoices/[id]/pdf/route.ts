import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import CompanyInvoice from '@/models/CompanyInvoice';
import { invoiceFileName, invoicePdf } from '@/services/billing/companyInvoice';

export const dynamic = 'force-dynamic';

/** Download one company invoice as PDF — only the workspace it was issued to. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  await dbConnect();
  const inv: any = await CompanyInvoice.findOne({ _id: id, businessId: ctx.businessId }).lean();
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  try {
    const pdf = await invoicePdf(inv);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${invoiceFileName(inv)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err: any) {
    console.error('[billing/invoice pdf] failed:', err?.message);
    return NextResponse.json({ error: 'Could not create the PDF right now. Please try again in a minute.' }, { status: 500 });
  }
}
