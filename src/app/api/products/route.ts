import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { requireWorkspacePlan } from '@/lib/planGate';
import Product from '@/models/Product';
import Business from '@/models/Business';
import { sanitizeProductInput } from '@/services/products/productText';
import { scheduleProductPosts } from '@/services/products/productPosts';

export const dynamic = 'force-dynamic';

const MAX_PRODUCTS = 200;

/** GET /api/products — the workspace's products + the auto-post setting. */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  await dbConnect();
  const [products, business] = await Promise.all([
    Product.find({ businessId: ctx.businessId, status: 'active' }).sort({ createdAt: -1 }).limit(MAX_PRODUCTS).lean(),
    Business.findById(ctx.businessId).select('productAutoPost website').lean<{ productAutoPost?: boolean; website?: string }>(),
  ]);
  return NextResponse.json({
    success: true,
    products,
    autoPost: business?.productAutoPost === true,
    website: business?.website || null,
  });
}

/**
 * POST /api/products — save products { items: [...], post?: boolean }.
 * post: true also schedules them as Google product posts (spaced out) and
 * turns on weekly auto-posting the first time.
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const planGate = await requireWorkspacePlan(ctx.userId, ctx.businessId);
  if (!planGate.ok) return planGate.response;
  const body = await req.json().catch(() => ({}));
  const items: unknown[] = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
  if (!items.length) return NextResponse.json({ success: false, error: 'Add at least one product.' }, { status: 400 });

  await dbConnect();
  const business: any = await Business.findById(ctx.businessId).select('website productAutoPost organizationId').lean();
  const count = await Product.countDocuments({ businessId: ctx.businessId, status: 'active' });
  if (count + items.length > MAX_PRODUCTS) {
    return NextResponse.json({ success: false, error: `You can keep up to ${MAX_PRODUCTS} products.` }, { status: 400 });
  }
  const clean = [];
  for (const raw of items) {
    const r = sanitizeProductInput(raw, { website: business?.website });
    if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 400 });
    clean.push({ ...r.product, source: (raw as any)?.source === 'photo_ai' ? 'photo_ai' : 'owner' });
  }
  const created = await Product.insertMany(clean.map((p) => ({
    ...p,
    businessId: ctx.businessId,
    organizationId: business?.organizationId ? String(business.organizationId) : undefined,
    createdBy: ctx.userId,
    status: 'active',
  })));

  let posting = null;
  if (body?.post === true) {
    posting = await scheduleProductPosts(String(ctx.businessId), created.map((p) => String(p._id)));
    // First products posted: keep them fresh weekly unless the owner turned it off before.
    if (business?.productAutoPost === undefined) {
      await Business.updateOne({ _id: ctx.businessId }, { $set: { productAutoPost: true } });
    }
  }
  return NextResponse.json({ success: true, products: created, posting });
}
