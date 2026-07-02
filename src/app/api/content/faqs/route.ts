import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';

const faqsSchema = z.object({
  faqs: z.array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1),
    })
  ).min(1, 'At least one FAQ is required'),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const body = await req.json();
    const parsed = faqsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    await dbConnect();

    await Business.findByIdAndUpdate(ctx.businessId, { faqs: parsed.data.faqs });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to save FAQs:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
