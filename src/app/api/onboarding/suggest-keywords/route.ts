import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import { suggestTargetKeywords } from '@/services/ai';
import { checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Target-keyword suggestions for the onboarding intake (web + app).
 * Keywords the business's own report / SEO plan already researched come
 * first (measured on Google Maps, then proposed by the plan); AI only fills
 * the rest of the batch. Each suggestion says where it came from.
 * Returns an error — not an empty success — when nothing could be suggested,
 * so the form shows "Couldn't load suggestions" instead of silently doing nothing.
 */

const bodySchema = z.object({
  category: z.string().trim().min(1),
  description: z.string().trim().optional().default(''),
  city: z.string().trim().optional().default(''),
  area: z.string().trim().optional().default(''),
  selectedKeywords: z.array(z.string()).optional().default([]),
  excludeKeywords: z.array(z.string()).optional().default([]),
});

const BATCH = 8;

export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

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

  const { category, description, city, area, selectedKeywords, excludeKeywords } = parsed.data;
  const skip = new Set([...selectedKeywords, ...excludeKeywords].map((k) => k.toLowerCase().trim()));

  const details: Array<{ keyword: string; source: 'measured' | 'proposed' | 'ai'; rank?: number | null }> = [];
  try {
    const { seoBrainKeywords } = await import('@/services/seoPlan/seoBrainKeywords');
    for (const k of await seoBrainKeywords(ctx.business as any)) {
      if (details.length >= BATCH) break;
      if (!skip.has(k.keyword.toLowerCase())) details.push(k);
    }
  } catch (err: any) {
    console.warn('[suggest-keywords] SEO brain unavailable:', err?.message);
  }

  if (details.length < BATCH) {
    const taken = new Set([...skip, ...details.map((d) => d.keyword.toLowerCase())]);
    const ai = await suggestTargetKeywords(category, description, selectedKeywords, Array.from(taken), {
      city: city || (ctx.business as any)?.city,
      area: area || (ctx.business as any)?.area,
    });
    for (const k of ai) {
      if (details.length >= BATCH) break;
      if (!taken.has(k.toLowerCase())) { details.push({ keyword: k, source: 'ai' }); taken.add(k.toLowerCase()); }
    }
  }

  if (details.length === 0) {
    return NextResponse.json({ success: false, error: "Couldn't find keyword suggestions right now — add your own or try again." }, { status: 502 });
  }
  return NextResponse.json({ success: true, keywords: details.map((d) => d.keyword), details });
}
