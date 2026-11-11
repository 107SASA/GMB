import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import AIUsageLog from '@/models/AIUsageLog';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { checkUsageLimit } from '@/lib/featureGating';
import { isStorageConfigured, uploadPrivateObject } from '@/lib/storage';
import { geminiApiKey, scanBusinessCard, type CardImage } from '@/services/crm/businessCardScan';
import { isEmptyExtraction } from '@/services/crm/businessCardParse';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const DAILY_LIMIT = Number(process.env.CARD_SCAN_DAILY_LIMIT) || 300;

/**
 * POST /api/leads/business-card/scan — multipart `front` (required) and
 * `back` (optional) photos of ONE visiting card. Reads the card with AI and
 * returns the form fields + private image keys. Saves NOTHING to the CRM —
 * the owner reviews the form and submits it to POST /api/leads/business-card.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent', ctx.businessId);
    if (!gate.ok) return gate.response;

    if (!geminiApiKey()) {
      return NextResponse.json({ error: 'Card scanning is not set up yet. Please add the lead manually.' }, { status: 503 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: 'Expected a photo upload.' }, { status: 400 });
    }
    const files = [form.get('front'), form.get('back')].filter((f): f is File => f instanceof File && f.size > 0);
    if (!(form.get('front') instanceof File) || files.length === 0) {
      return NextResponse.json({ error: 'Take a photo of the front of the card.' }, { status: 400 });
    }
    for (const f of files) {
      if (!ALLOWED.includes(f.type.toLowerCase())) {
        return NextResponse.json({ error: 'Only JPG, PNG or WebP photos are supported.' }, { status: 400 });
      }
      if (f.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: 'The photo is too large. Please retake it.' }, { status: 413 });
      }
    }

    await dbConnect();
    // Plan cap (monthly, editable per plan / per customer by the super admin).
    const quota = await checkUsageLimit(ctx.userId, ctx.businessId, 'cardScans');
    if (!quota.allowed) {
      return NextResponse.json(
        { error: `You've used all ${quota.limit} card scans for this month. You can still add the lead by typing the details.`, code: quota.code, limit: quota.limit, used: quota.used },
        { status: 403 },
      );
    }
    // Abuse guard on top — each scan is a paid AI call.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const used = await AIUsageLog.countDocuments({
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
      promptType: { $in: ['business_card_scan', 'business_card_scan_retry'] },
      createdAt: { $gte: since },
    });
    if (used >= DAILY_LIMIT) {
      return NextResponse.json({ error: `Daily card scan limit reached (${DAILY_LIMIT}). Try again tomorrow or add the lead manually.` }, { status: 429 });
    }

    // Fix rotation from the camera, shrink to ≤1600px (fewer AI tokens, smaller storage).
    const sharp = (await import('sharp')).default;
    const images: CardImage[] = [];
    for (const f of files) {
      const input = Buffer.from(await f.arrayBuffer());
      const data = await sharp(input)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
        .catch(() => null);
      if (!data) return NextResponse.json({ error: 'Could not read that photo. Please retake it.' }, { status: 400 });
      images.push({ data, mimeType: 'image/jpeg' });
    }

    const [result, imageKeys] = await Promise.all([
      scanBusinessCard(images, { userId: ctx.userId, businessId: ctx.businessId }),
      // Card photos are personal data — private objects, never public URLs.
      isStorageConfigured()
        ? Promise.all(images.map((img) => uploadPrivateObject(img.data, img.mimeType, `business-cards/${ctx.businessId}`))).catch((e) => {
            console.error('[business-card/scan] image store failed:', e?.message);
            return [] as string[];
          })
        : Promise.resolve([] as string[]),
    ]);

    if (!result.fields.isBusinessCard || isEmptyExtraction(result.fields)) {
      return NextResponse.json(
        { error: "We couldn't find card details in that photo. Hold the card flat in good light and try again.", fields: result.fields, imageKeys },
        { status: 422 },
      );
    }

    return NextResponse.json({ success: true, fields: result.fields, imageKeys });
  } catch (error: any) {
    console.error('[business-card/scan]', error?.message);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
