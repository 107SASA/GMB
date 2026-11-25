import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { requireWorkspacePlan } from '@/lib/planGate';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { isStorageConfigured, uploadPublicObject } from '@/lib/storage';
import { geminiApiKey } from '@/services/crm/businessCardScan';
import { scanProductPhoto } from '@/services/products/productScan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_PHOTOS = 10;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * POST /api/products/scan — multipart `photos` (1–10, one product each).
 * Stores each photo at a public URL (Google fetches post photos by URL) and
 * reads the product with AI. Returns drafts to check; nothing is saved.
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const planGate = await requireWorkspacePlan(ctx.userId, ctx.businessId);
  if (!planGate.ok) return planGate.response;
  if (!isStorageConfigured()) return NextResponse.json({ success: false, error: 'Photo upload is not set up yet.' }, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Upload product photos.' }, { status: 400 });
  }
  const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_PHOTOS);
  if (!files.length) return NextResponse.json({ success: false, error: 'Upload at least one product photo.' }, { status: 400 });
  for (const f of files) {
    if (!ALLOWED.includes(f.type.toLowerCase())) return NextResponse.json({ success: false, error: 'Only JPG, PNG or WebP photos are supported.' }, { status: 400 });
    if (f.size > MAX_IMAGE_BYTES) return NextResponse.json({ success: false, error: 'A photo is too large (max 10 MB).' }, { status: 413 });
  }
  const rate = await checkDurableRateLimit(`product-scan:${ctx.businessId}`, 100, 24 * 60 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: 'You’ve added a lot of products today. Please continue tomorrow.' }, { status: 429 });

  const biz = { name: String(ctx.business?.name || ''), category: String(ctx.business?.category || ''), city: String(ctx.business?.city || '') };
  const canRead = !!geminiApiKey();
  const drafts = await Promise.all(files.map(async (f) => {
    const mimeType = f.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : f.type.toLowerCase();
    const data = Buffer.from(await f.arrayBuffer());
    try {
      const imageUrl = await uploadPublicObject(data, mimeType, `products/${ctx.businessId}`);
      const read = canRead
        ? await scanProductPhoto({ data, mimeType }, biz, { userId: ctx.userId, businessId: String(ctx.businessId) }).catch(() => null)
        : null;
      return { imageUrl, name: read?.name || '', category: read?.category || '', description: read?.description || '', price: read?.price ?? null, source: read?.name ? 'photo_ai' : 'owner', read: !!read?.name };
    } catch (err: any) {
      console.error('[product-scan]', err?.message);
      return null;
    }
  }));
  const ok = drafts.filter(Boolean);
  if (!ok.length) return NextResponse.json({ success: false, error: 'We couldn’t upload these photos. Please try again.' }, { status: 502 });
  return NextResponse.json({ success: true, drafts: ok, unread: ok.filter((d: any) => !d.read).length });
}
