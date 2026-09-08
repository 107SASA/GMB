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
      // 'Local Business' is the generic placeholder Business.create() falls
      // back to when onboarding couldn't auto-fill a real one (see
      // /api/onboarding) — never prefill that as if it were a real answer.
      category: [b.userDefinedCategory, b.category].find((c) => c && c !== 'Local Business') ?? '',
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
  category: z.string().trim().min(1, 'Please enter your business category.'),
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
        category: d.category,
        userDefinedCategory: d.category,
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

  // Merge the owner's answers into a new SEO-brain version — their keywords,
  // USP, services and description now lead. Best-effort: intake still
  // succeeds if the brain isn't seeded yet (e.g. the free audit failed).
  try {
    const { mergeIntakeIntoSeoPlan } = await import('@/services/seoPlan/seoPlanService');
    await mergeIntakeIntoSeoPlan(String(ctx.businessId), {
      category: d.category,
      description: d.description,
      services: d.services,
      keywords,
      uniqueSellingPoints: d.uniqueSellingPoints,
      targetAudience: d.targetAudience,
      competitorNames: cleanList(d.competitorNames),
      primaryGoal: d.primaryGoal,
    });
  } catch (err) {
    console.error('[intake] mergeIntakeIntoSeoPlan failed:', err);
  }

  // Completing intake is the moment a real business category exists — for a
  // subscribed, Google-connected workspace this is the last of the three
  // conditions the automatic first audit waits on. Best-effort; the hourly
  // auditAutopilotCron is the safety net if this misses.
  try {
    const { maybeStartAuditAutopilot } = await import('@/lib/auditAutopilot');
    await maybeStartAuditAutopilot(String(ctx.businessId));
  } catch (err) {
    console.error('[intake] maybeStartAuditAutopilot failed:', err);
  }

  return NextResponse.json({ success: true });
}
