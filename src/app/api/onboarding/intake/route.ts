import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/**
 * Post-payment intake for the active workspace. GET prefills the form from
 * whatever the business already has; POST saves the richer marketing info and
 * marks intakeCompleted so the dashboard unlocks (gate lives in src/proxy.ts).
 */

const cleanKeywords = (arr?: string[]) =>
  (arr ?? [])
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => /[a-zA-Z]/.test(s)) // drop symbol/number-only junk like "."
    .slice(0, 30);

const cleanList = (arr?: string[]) =>
  (arr ?? [])
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .slice(0, 20);

export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  const b = ctx.business;
  return NextResponse.json({
    success: true,
    intakeCompleted: Boolean(b.intakeCompleted),
    data: {
      description: b.description ?? '',
      services: b.services ?? '',
      offers: b.offers ?? '',
      keywords: Array.isArray(b.keywords) ? b.keywords.filter((k: string) => /[a-zA-Z]/.test(k)) : [],
      city: b.city ?? '',
      area: b.area ?? '',
      tone: b.tone ?? 'professional',
      uniqueSellingPoints: b.intake?.uniqueSellingPoints ?? '',
      targetAudience: b.intake?.targetAudience ?? '',
      competitorNames: b.intake?.competitorNames ?? [],
      primaryGoal: b.intake?.primaryGoal ?? '',
    },
  });
}

const intakeSchema = z.object({
  description: z.string().trim().min(10, 'Please describe your business (at least 10 characters).'),
  services: z.string().trim().min(3, 'List the services you offer.'),
  offers: z.string().trim().optional().default(''),
  keywords: z.array(z.string()).min(1, 'Add at least one target keyword.'),
  city: z.string().trim().optional().default(''),
  area: z.string().trim().optional().default(''),
  tone: z.string().trim().optional().default('professional'),
  uniqueSellingPoints: z.string().trim().optional().default(''),
  targetAudience: z.string().trim().optional().default(''),
  competitorNames: z.array(z.string()).optional().default([]),
  primaryGoal: z.string().trim().optional().default(''),
});

export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  const body = await req.json().catch(() => null);
  const parsed = intakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const keywords = cleanKeywords(d.keywords);
  if (keywords.length === 0) {
    return NextResponse.json({ success: false, error: 'Add at least one valid target keyword.' }, { status: 400 });
  }

  await dbConnect();
  await Business.updateOne(
    { _id: ctx.businessId },
    {
      $set: {
        description: d.description,
        services: d.services,
        offers: d.offers,
        keywords,
        ...(d.city ? { city: d.city } : {}),
        ...(d.area ? { area: d.area } : {}),
        tone: d.tone || 'professional',
        intakeCompleted: true,
        intake: {
          uniqueSellingPoints: d.uniqueSellingPoints,
          targetAudience: d.targetAudience,
          competitorNames: cleanList(d.competitorNames),
          primaryGoal: d.primaryGoal,
        },
      },
    }
  );

  return NextResponse.json({ success: true });
}
