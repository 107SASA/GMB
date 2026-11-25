import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { requireWorkspacePlan } from '@/lib/planGate';
import Business from '@/models/Business';
import { scheduleProductPosts } from '@/services/products/productPosts';

export const dynamic = 'force-dynamic';

/**
 * POST /api/products/post
 *  { ids: string[] | 'all' } → schedule product posts on Google (2 days apart)
 *  { autoPost: boolean }     → weekly automatic product posts on / off
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const planGate = await requireWorkspacePlan(ctx.userId, ctx.businessId);
  if (!planGate.ok) return planGate.response;
  const body = await req.json().catch(() => ({}));
  await dbConnect();
  if (typeof body?.autoPost === 'boolean') {
    await Business.updateOne({ _id: ctx.businessId }, { $set: { productAutoPost: body.autoPost } });
    return NextResponse.json({ success: true, autoPost: body.autoPost });
  }
  const ids = body?.ids === 'all' ? 'all' : Array.isArray(body?.ids) ? body.ids.map(String).slice(0, 200) : null;
  if (!ids || (Array.isArray(ids) && !ids.length)) return NextResponse.json({ success: false, error: 'Choose products to post.' }, { status: 400 });
  const posting = await scheduleProductPosts(String(ctx.businessId), ids);
  return NextResponse.json({ success: true, posting });
}
