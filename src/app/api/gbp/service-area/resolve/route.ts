import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import { resolveAreaPlaces } from '@/lib/gbpClient';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  queries: z.array(z.string().trim().min(2).max(80)).min(1).max(20),
});

/** Resolves city or PIN text to Google place ids. Does not write a service area. */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Provide up to 20 city or PIN queries.' }, { status: 400 });
  }
  const results = [];
  let configured = true;
  for (const query of parsed.data.queries) {
    const found = await resolveAreaPlaces(query);
    configured = found.configured;
    results.push({ query, places: found.places });
  }
  return NextResponse.json({
    success: true,
    writes: false,
    configured,
    results,
    note: configured
      ? 'Pick a resolved place. A raw PIN is not sent to Google.'
      : 'Place resolution is not configured. No place id was guessed.',
  });
}
