import { NextResponse, NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { requireCrmModule } from '@/lib/moduleGating';
import { getPrivateObject, isStorageConfigured } from '@/lib/storage';
import { isOwnCardImageKey } from '@/services/crm/businessCardParse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/crm/leads/[id]/card-image?side=0|1 — the scanned visiting-card
 * photo (0 = front, 1 = back). Card photos are private objects; this route is
 * the only way to view them, scoped to the signed-in user's workspace.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const gate = await requireCrmModule(ctx.userId, ctx.businessId);
  if (!gate.ok) return gate.response;
  if (!isStorageConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { id } = await params;
  const side = req.nextUrl.searchParams.get('side') === '1' ? 1 : 0;
  await dbConnect();
  const lead: any = await Lead.findOne({ _id: id, businessId: ctx.businessId }).select('businessCard.imageKeys').lean().catch(() => null);
  const key = lead?.businessCard?.imageKeys?.[side];
  if (!isOwnCardImageKey(key, ctx.businessId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const obj = await getPrivateObject(key);
  if (!obj) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new NextResponse(new Uint8Array(obj.body), {
    headers: {
      'Content-Type': obj.contentType,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
