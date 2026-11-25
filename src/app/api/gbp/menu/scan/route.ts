import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { requireWorkspacePlan } from '@/lib/planGate';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { getFoodMenus } from '@/lib/gbpClient';
import { geminiApiKey, type CardImage } from '@/services/crm/businessCardScan';
import { scanMenuPhotos } from '@/services/gbp/menuScan';
import { foodMenusToDraft, mergeMenuDrafts } from '@/services/gbp/changes/richSections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_PHOTOS = 4;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * POST /api/gbp/menu/scan — multipart `photos` (1–4 photos of the menu).
 * Reads the dishes with AI and returns the menu to approve: the current
 * Google menu with the new dishes added. Nothing is sent to Google here —
 * the owner checks it and proposes it (POST /api/gbp/changes, kind food_menu).
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const planGate = await requireWorkspacePlan(ctx.userId, ctx.businessId);
  if (!planGate.ok) return planGate.response;
  if (!geminiApiKey()) return NextResponse.json({ success: false, error: 'Menu reading is not set up yet.' }, { status: 503 });

  const rate = await checkDurableRateLimit(`menu-scan:${ctx.businessId}`, 15, 24 * 60 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: 'You’ve read a lot of menus today. Please try again tomorrow.' }, { status: 429 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Upload photos of your menu.' }, { status: 400 });
  }
  const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_PHOTOS);
  if (!files.length) return NextResponse.json({ success: false, error: 'Upload at least one photo of your menu.' }, { status: 400 });
  const images: CardImage[] = [];
  for (const f of files) {
    if (!ALLOWED.includes(f.type.toLowerCase())) return NextResponse.json({ success: false, error: 'Only JPG, PNG or WebP photos are supported.' }, { status: 400 });
    if (f.size > MAX_IMAGE_BYTES) return NextResponse.json({ success: false, error: 'A photo is too large (max 12 MB).' }, { status: 413 });
    images.push({ data: Buffer.from(await f.arrayBuffer()), mimeType: f.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : f.type.toLowerCase() });
  }

  try {
    const scanned = await scanMenuPhotos(images, { userId: ctx.userId, businessId: String(ctx.businessId) });
    const found = scanned.sections.reduce((n, s) => n + s.items.length, 0);
    if (!found) return NextResponse.json({ success: false, error: 'We couldn’t find any dishes in these photos. Try a clearer, straight-on photo of the menu.' }, { status: 422 });
    const current = await getFoodMenus(String(ctx.businessId)).then(foodMenusToDraft).catch(() => null);
    const draft = mergeMenuDrafts(current, scanned);
    const before = current ? current.sections.reduce((n, s) => n + s.items.length, 0) : 0;
    const total = draft.sections.reduce((n, s) => n + s.items.length, 0);
    return NextResponse.json({ success: true, draft, found, added: total - before, missingPrices: draft.sections.flatMap((s) => s.items).filter((i) => i.price == null).length });
  } catch (err: any) {
    console.error('[menu-scan]', err?.message);
    return NextResponse.json({ success: false, error: 'We couldn’t read the menu right now. Please try again.' }, { status: 502 });
  }
}
