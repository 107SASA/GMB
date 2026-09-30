import { guardedFetchBuffer } from '@/lib/ssrfGuard';
import { brandedGraphic, watermarkImageBuffer } from '@/lib/imageWatermark';
import { isStorageConfigured, uploadPublicObject } from '@/lib/storage';
import { geotagMedia, type GeotagResult, type VerifiedLocation } from '@/lib/imageGeotag';
import type { ContentFacts, PlannedSlot } from './plan';
import { buildImagePrompt, chooseImageSource, type ImageSource } from './creative';

/**
 * Image I/O for weekly posts. Real customer photos are used as they are
 * (never re-branded, never altered). Generated images and the branded
 * fallback carry the CUSTOMER's logo when one exists — never GrowwMatics'.
 * Every image we store for a post goes through the geotag policy
 * (lib/imageGeotag.ts): existing GPS kept, else the business's verified
 * Google location added, else nothing. Customer photos were already
 * processed at upload and are reused byte-for-byte.
 */

export async function fetchLogo(url?: string | null): Promise<Buffer | null> {
  if (!url || !/^https:\/\//i.test(url)) return null;
  const r = await guardedFetchBuffer(url, { maxBytes: 3_000_000 });
  return r && /^image\//.test(r.contentType) ? r.body : null;
}

/** Dominant non-grey colours of the customer's logo (for brand colour priority 2). */
export async function logoColors(logo: Buffer | null): Promise<string[]> {
  if (!logo) return [];
  try {
    const sharp = (await import('sharp')).default;
    const { dominant } = await sharp(logo).stats();
    const hex = `#${[dominant.r, dominant.g, dominant.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    const max = Math.max(dominant.r, dominant.g, dominant.b);
    const min = Math.min(dominant.r, dominant.g, dominant.b);
    return max - min > 40 && max > 40 && min < 235 ? [hex] : [];
  } catch {
    return [];
  }
}

async function store(buffer: Buffer, mime: string, businessId: string, location: VerifiedLocation | null): Promise<{ url: string; geotag: GeotagResult }> {
  const g = await geotagMedia(buffer, mime, location);
  const url = isStorageConfigured()
    ? await uploadPublicObject(g.buffer, g.mime, `post-thumbnails/${businessId}`)
    : `data:${g.mime};base64,${g.buffer.toString('base64')}`;
  return { url, geotag: g.geotag };
}

export interface ImageResult { imageUrl?: string; imageSource: ImageSource['kind'] | 'none'; imageAssetId?: string; note?: string; geotag?: GeotagResult | { status: 'not_recorded'; reason: string } }

export async function imageForSlot(opts: {
  businessId: string;
  slot: PlannedSlot;
  facts: ContentFacts;
  colors: string[];
  customerLogo: Buffer | null;
  customerPhotos: Array<{ id: string; url: string; geotag?: GeotagResult }>;
  recentlyUsedPhotoIds: string[];
  /** Verified Google location for GPS metadata (null → none added). */
  location?: VerifiedLocation | null;
  websiteImages: Array<{ url: string; sourceUrl?: string }>;
  offerImageId?: string | null;
  headline: string;
  /** Injected in tests; defaults to the real generator. */
  generate?: (prompt: string) => Promise<string | null>;
}): Promise<ImageResult> {
  const generate = opts.generate ?? (async (p: string) => (await import('@/services/ai/imageGenerator')).generateThumbnail(p));
  const imageGenerationAvailable = !!process.env.NANOBANANA_API_KEY || !!opts.generate;
  const choice = chooseImageSource(opts.slot, {
    customerPhotos: opts.customerPhotos,
    recentlyUsedPhotoIds: opts.recentlyUsedPhotoIds,
    websiteImages: opts.websiteImages,
    offerImageId: opts.offerImageId,
    imageGenerationAvailable,
  });
  const location = opts.location ?? null;
  if (choice.kind === 'customer_photo') {
    const g = opts.customerPhotos.find((p) => p.id === choice.assetId)?.geotag;
    return { imageUrl: choice.url, imageSource: 'customer_photo', imageAssetId: choice.assetId, geotag: g ?? { status: 'not_recorded', reason: 'photo uploaded before location handling was recorded' } };
  }
  if (choice.kind === 'website_image') {
    // Re-hosted so the bytes Google fetches are ours to geotag (and don't depend on the site staying up).
    try {
      const r = await guardedFetchBuffer(choice.url, { maxBytes: 10_000_000 });
      const mime = r?.contentType.split(';')[0].trim().toLowerCase();
      if (r && mime && /^image\/(jpeg|jpg|png|webp)$/.test(mime)) {
        const stored = await store(r.body, mime, opts.businessId, location);
        return { imageUrl: stored.url, imageSource: 'website_image', geotag: stored.geotag, note: `from ${choice.url}` };
      }
    } catch (err: any) {
      console.warn('[content/images] website image unavailable:', err?.message);
    }
  }

  if (choice.kind === 'generate' || (choice.kind === 'website_image' && imageGenerationAvailable)) {
    try {
      const out = await generate(buildImagePrompt(opts.slot, opts.facts, opts.colors));
      if (out) {
        const buf = out.startsWith('data:')
          ? Buffer.from(out.split(',')[1], 'base64')
          : (await guardedFetchBuffer(out))?.body ?? null;
        if (buf) {
          const { buffer, mime } = await watermarkImageBuffer(buf, opts.customerLogo);
          const stored = await store(buffer, mime, opts.businessId, location);
          return { imageUrl: stored.url, imageSource: 'generate', geotag: stored.geotag };
        }
      }
    } catch (err: any) {
      console.warn('[content/images] generation failed — using branded graphic:', err?.message);
    }
  }
  // Fallback: a plain branded graphic — never an invented scene.
  try {
    const { buffer, mime } = await brandedGraphic({ headline: opts.headline, subline: opts.facts.businessName, colors: opts.colors, customerLogo: opts.customerLogo });
    const stored = await store(buffer, mime, opts.businessId, location);
    return { imageUrl: stored.url, imageSource: 'branded_graphic', geotag: stored.geotag, note: choice.kind === 'generate' ? 'image generation failed' : 'no photo and no image generation' };
  } catch (err: any) {
    return { imageSource: 'none', note: `no image: ${err?.message}` };
  }
}
