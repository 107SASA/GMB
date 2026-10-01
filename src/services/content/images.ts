import { guardedFetchBuffer } from '@/lib/ssrfGuard';
import { createHash } from 'crypto';
import { addOfferTextBand, brandedGraphic, watermarkImageBuffer } from '@/lib/imageWatermark';
import { isStorageConfigured, uploadPublicObject } from '@/lib/storage';
import { geotagMedia, type GeotagResult, type VerifiedLocation } from '@/lib/imageGeotag';
import type { ContentFacts, PlannedSlot } from './plan';
import { buildImagePrompt, chooseImageSource, type ImageOrigin, type ImageSource } from './creative';

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

export interface ImageResult {
  imageUrl?: string;
  /** Existing field kept for compatibility: generate | customer_photo | branded_graphic | none. */
  imageSource: ImageSource['kind'] | 'none';
  /** Where the image came from — what the monthly report counts. */
  imageOrigin: ImageOrigin;
  /** Set only for an owner-selected Photos asset. */
  imageAssetId?: string;
  note?: string;
  geotag?: GeotagResult | { status: 'not_recorded'; reason: string };
  /** AI generation outcome for this post (attempts, failure reason, image fingerprint). */
  imageGeneration: { status: 'generated' | 'failed' | 'unavailable' | 'duplicate' | 'not_attempted'; attempts: number; error?: string; hash?: string };
  /** The brand applied to the image. */
  brandUsed: { colors: string[]; colorSource?: string | null; logo: boolean };
}

/**
 * The image for ONE weekly autopilot post. Default: a NEW AI image generated
 * from this post's own context (the same purpose / SEO theme / keyword /
 * service / area / text the post was written from), with the customer's
 * colours and logo — never GrowwMatics'. A Photos-section photo is used only
 * when the owner explicitly chose it for this post. If generation is
 * unavailable, fails, or returns an image already used for another post, the
 * approved fallback is a plain branded graphic, and the failure is recorded —
 * never a customer or website photo picked on the owner's behalf.
 * Every stored image then goes through the existing geotag step.
 */
export async function imageForSlot(opts: {
  businessId: string;
  slot: PlannedSlot;
  facts: ContentFacts;
  colors: string[];
  colorSource?: string | null;
  customerLogo: Buffer | null;
  customerPhotos: Array<{ id: string; url: string; geotag?: GeotagResult }>;
  /** Verified Google location for GPS metadata (null → none added). */
  location?: VerifiedLocation | null;
  /** Photo the owner explicitly picked in the weekly offer question. */
  offerImageId?: string | null;
  /** Photo the owner explicitly picked for this post. */
  ownerSelectedPhotoId?: string | null;
  /** The written post, so the image shows the same topic. */
  post?: { title?: string; body?: string } | null;
  /** Fingerprints of images already used (this batch + recent posts) — a repeat is never presented as new. */
  usedImageHashes?: Set<string>;
  headline: string;
  /** Injected in tests; defaults to the real generator. */
  generate?: (prompt: string) => Promise<string | null>;
}): Promise<ImageResult> {
  const generate = opts.generate ?? (async (p: string) => (await import('@/services/ai/imageGenerator')).generateThumbnail(p));
  const imageGenerationAvailable = !!process.env.NANOBANANA_API_KEY || !!opts.generate;
  const brandUsed = { colors: opts.colors, colorSource: opts.colorSource ?? null, logo: !!opts.customerLogo };
  const location = opts.location ?? null;
  const choice = chooseImageSource(opts.slot, {
    customerPhotos: opts.customerPhotos,
    offerImageId: opts.offerImageId,
    ownerSelectedPhotoId: opts.ownerSelectedPhotoId,
    imageGenerationAvailable,
  });

  if (choice.kind === 'customer_photo') {
    const g = opts.customerPhotos.find((p) => p.id === choice.assetId)?.geotag;
    return {
      imageUrl: choice.url, imageSource: 'customer_photo', imageOrigin: 'OWNER_SELECTED', imageAssetId: choice.assetId,
      geotag: g ?? { status: 'not_recorded', reason: 'photo uploaded before location handling was recorded' },
      imageGeneration: { status: 'not_attempted', attempts: 0 }, brandUsed: { ...brandUsed, logo: false },
      note: 'photo chosen by the owner for this post',
    };
  }

  const generation: ImageResult['imageGeneration'] = { status: imageGenerationAvailable ? 'failed' : 'unavailable', attempts: 0 };
  if (choice.kind === 'generate') {
    const basePrompt = buildImagePrompt(opts.slot, opts.facts, opts.colors, opts.post);
    for (let attempt = 1; attempt <= 2; attempt++) {
      generation.attempts = attempt;
      try {
        const prompt = attempt === 1 ? basePrompt : `${basePrompt} Use a clearly different composition, viewpoint and arrangement from any previous image.`;
        const out = await generate(prompt);
        if (!out) { generation.error = 'image generator returned nothing'; break; }
        const raw = out.startsWith('data:')
          ? Buffer.from(out.split(',')[1], 'base64')
          : (await guardedFetchBuffer(out))?.body ?? null;
        if (!raw) { generation.error = 'generated image could not be downloaded'; break; }
        const hash = createHash('sha256').update(raw).digest('hex');
        if (opts.usedImageHashes?.has(hash)) {
          // Same picture as another post — retry once, then fall back rather than present it as new.
          generation.status = 'duplicate';
          generation.error = 'generator returned an image already used for another post';
          generation.hash = hash;
          continue;
        }
        let { buffer, mime } = await watermarkImageBuffer(raw, opts.customerLogo);
        if (opts.slot.purpose === 'offer' && opts.slot.offerText) {
          // The owner's exact offer words, drawn by us — never by the image model.
          ({ buffer, mime } = await addOfferTextBand(buffer, opts.slot.offerText, opts.colors));
        }
        const stored = await store(buffer, mime, opts.businessId, location);
        opts.usedImageHashes?.add(hash);
        return {
          imageUrl: stored.url, imageSource: 'generate', imageOrigin: 'AI_GENERATED', geotag: stored.geotag,
          imageGeneration: { status: 'generated', attempts: attempt, hash }, brandUsed,
        };
      } catch (err: any) {
        generation.status = 'failed';
        generation.error = String(err?.message || err).slice(0, 200);
        console.warn('[content/images] generation failed — using branded graphic:', generation.error);
        break;
      }
    }
  }

  // Approved fallback: a plain branded graphic — never an invented scene, never someone's photo.
  try {
    let { buffer, mime } = await brandedGraphic({ headline: opts.headline, subline: opts.facts.businessName, colors: opts.colors, customerLogo: opts.customerLogo });
    if (opts.slot.purpose === 'offer' && opts.slot.offerText) ({ buffer, mime } = await addOfferTextBand(buffer, opts.slot.offerText, opts.colors));
    const stored = await store(buffer, mime, opts.businessId, location);
    return {
      imageUrl: stored.url, imageSource: 'branded_graphic', imageOrigin: 'FALLBACK', geotag: stored.geotag,
      imageGeneration: generation, brandUsed,
      note: generation.status === 'unavailable' ? 'image generation not configured — branded graphic used' : `AI image not used (${generation.error ?? generation.status}) — branded graphic used`,
    };
  } catch (err: any) {
    return { imageSource: 'none', imageOrigin: 'NONE', imageGeneration: generation, brandUsed, note: `no image: ${err?.message}` };
  }
}
