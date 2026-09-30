import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import GbpMediaAsset from '@/models/GbpMediaAsset';
import { requireBusinessContext } from '@/lib/tenant';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * Brand colours used on generated post images. Priority: colours the owner
 * set here > customer logo > website > theme colour > neutral. Colours set
 * here are never overwritten by automation. The logo is the one uploaded in
 * Photos (LOGO), else the website's logo.
 */

export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    await dbConnect();
    const b: any = await Business.findById(ctx.businessId).select('brandProfile').lean();
    const logo: any = await GbpMediaAsset.findOne({ businessId: ctx.businessId, category: 'LOGO', status: { $in: ['published', 'staged'] } }).sort({ createdAt: -1 }).select('url').lean();
    const bp = b?.brandProfile || {};
    return NextResponse.json({
      success: true,
      manualColors: bp.manualColors || [],
      colors: bp.colors || [],
      colorSource: bp.colorSource || null,
      logoUrl: logo?.url || bp.logoUrl || null,
      logoSource: logo?.url ? 'customer_upload' : bp.logoSource || null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}

const schema = z.object({
  manualColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(4),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'Colours must be hex values like #1a73e8 (up to 4).' }, { status: 400 });
    await dbConnect();
    const manualColors = Array.from(new Set(parsed.data.manualColors.map((c) => c.toLowerCase())));
    await Business.updateOne({ _id: ctx.businessId }, { $set: { 'brandProfile.manualColors': manualColors } });
    return NextResponse.json({ success: true, manualColors });
  } catch (err: any) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}
