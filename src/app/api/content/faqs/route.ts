import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

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
    // ADDITIVE (Sep 2026) — content_studio was never actually enforced
    // server-side; see lib/moduleGating.ts.
    const gate = await requireModule(ctx.userId, 'content_studio');
    if (!gate.ok) return gate.response;

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
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
