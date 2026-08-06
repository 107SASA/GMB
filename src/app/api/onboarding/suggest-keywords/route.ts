import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import { suggestTargetKeywords } from '@/services/ai';
import { checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Target-keyword suggestions for the post-payment intake form
 * (dashboard/onboarding/intake) — see suggestTargetKeywords in services/ai.ts.
 * Called once for the initial batch (category + description only), then
 * again each time the user wants "more like this" (selectedKeywords passed
 * back so the next batch leans into that theme).
 */

const bodySchema = z.object({
  category: z.string().trim().min(1),
  description: z.string().trim().optional().default(''),
  selectedKeywords: z.array(z.string()).optional().default([]),
  excludeKeywords: z.array(z.string()).optional().default([]),
});

export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  // Each call is a real LLM request — cap it well above normal usage
  // (a user clicking through a few "more like this" rounds) but block outright abuse.
  const rl = checkRateLimit(`suggest-keywords:${ctx.userId}`, 20, 5 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Please slow down — try again in a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    );
  }

  const { category, description, selectedKeywords, excludeKeywords } = parsed.data;
  const keywords = await suggestTargetKeywords(category, description, selectedKeywords, excludeKeywords);

  return NextResponse.json({ success: true, keywords });
}
