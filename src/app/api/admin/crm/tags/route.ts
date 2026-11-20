import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { scoped } from '@/lib/admin/conversionFunnel';

export const dynamic = 'force-dynamic';

/** Every tag on the platform's leads, for the Leads & Pipeline "Tag" filter. */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const raw: unknown[] = await Lead.distinct('tags', scoped());
    const seen = new Map<string, string>();
    for (const t of raw) {
      const tag = String(t ?? '').trim();
      if (tag && !seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
    }
    const tags = [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return NextResponse.json({ success: true, tags });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
