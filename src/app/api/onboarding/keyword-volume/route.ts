import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import { ownerKeywordVolumes } from '@/services/seo/ownerKeywordVolume';

export const dynamic = 'force-dynamic';

/**
 * Google monthly searches for keywords the owner typed (onboarding intake and
 * Settings), so they can see which ones people actually search. Cached and
 * capped per business per day (services/seo/ownerKeywordVolume.ts).
 */
const bodySchema = z.object({ keywords: z.array(z.string().max(120)).min(1).max(30) });

export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid keywords.' }, { status: 400 });
  const { volumes, limited } = await ownerKeywordVolumes(String(ctx.businessId), parsed.data.keywords, (ctx.business as any)?.country);
  return NextResponse.json({ success: true, volumes, limited });
}
