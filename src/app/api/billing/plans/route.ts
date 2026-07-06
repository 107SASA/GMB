import { NextResponse } from 'next/server';
import { publicCatalog } from '@/lib/billing/planCatalog';

export const dynamic = 'force-dynamic';

/** Public: the sellable plan catalog for the pricing page. */
export async function GET() {
  return NextResponse.json({ success: true, plans: publicCatalog() });
}
