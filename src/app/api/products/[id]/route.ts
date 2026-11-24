import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import Product from '@/models/Product';
import Business from '@/models/Business';
import { sanitizeProductInput } from '@/services/products/productText';

export const dynamic = 'force-dynamic';

/** PATCH /api/products/:id — edit one product (posts already on Google are not changed). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, error: 'Product not found.' }, { status: 404 });
  await dbConnect();
  const existing: any = await Product.findOne({ _id: id, businessId: ctx.businessId, status: 'active' }).lean();
  if (!existing) return NextResponse.json({ success: false, error: 'Product not found.' }, { status: 404 });
  const business: any = await Business.findById(ctx.businessId).select('website').lean();
  const body = await req.json().catch(() => ({}));
  const r = sanitizeProductInput({ ...existing, ...body }, { website: business?.website });
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 400 });
  const product = await Product.findOneAndUpdate({ _id: id, businessId: ctx.businessId }, { $set: r.product }, { new: true }).lean();
  return NextResponse.json({ success: true, product });
}

/** DELETE /api/products/:id — removes it from the list (posts already on Google stay). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, error: 'Product not found.' }, { status: 404 });
  await dbConnect();
  const res = await Product.updateOne({ _id: id, businessId: ctx.businessId }, { $set: { status: 'archived' } });
  return NextResponse.json({ success: res.matchedCount > 0 });
}
