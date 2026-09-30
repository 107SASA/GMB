/**
 * Creative decisions — pure (runs under `node --test`): safe template posts,
 * brand-profile priority, image-source selection and the image prompt.
 *
 * Images: real customer photos first; generated images only show the verified
 * service/category/festival in brand colours; if generation fails the
 * fallback is a plain branded graphic — never an invented business scene.
 * The customer's logo is the only logo used (never GrowwMatics').
 */
import type { ContentFacts, PlannedSlot } from './plan.ts';

// ── Safe template posts (AI unavailable) — saved as DRAFT for owner review ──

export function templatePost(slot: PlannedSlot, f: ContentFacts): { title: string; body: string; cta: string } {
  const place = [f.area, f.city].filter(Boolean).join(', ') || f.city || '';
  const inPlace = place ? ` in ${place}` : '';
  const category = f.category && !/^local business$/i.test(f.category) ? f.category : '';
  switch (slot.purpose) {
    case 'offer':
      return { title: `This week at ${f.businessName}`, body: slot.offerText || '', cta: 'Call now' };
    case 'festival':
      return { title: `Happy ${slot.festival?.name}`, body: `${f.businessName} wishes everyone a happy ${slot.festival?.name}.`, cta: 'Learn more' };
    default:
      if (slot.service) {
        return { title: `${slot.service}${f.city ? ` in ${f.city}` : ''}`, body: `${f.businessName} provides ${slot.service}${inPlace}. Get in touch to discuss what you need.`, cta: 'Learn more' };
      }
      return {
        title: `${f.businessName}${category ? ` — ${category}` : ''}`,
        body: `${f.businessName}${category ? ` is a ${category.toLowerCase()}` : ''}${inPlace}. Get in touch to discuss what you need.`,
        cta: 'Learn more',
      };
  }
}

// ── Brand profile ─────────────────────────────────────────────────────────

export type ColorSource = 'manual' | 'logo' | 'website' | 'theme' | 'default';
export const NEUTRAL_COLORS = ['#1f2937', '#f3f4f6'];

export interface BrandInputs {
  manualColors?: string[] | null;
  logoColors?: string[] | null;
  websiteColors?: string[] | null;
  themeColors?: string[] | null;
  logoUrl?: string | null;
  logoSource?: 'customer_upload' | 'website' | null;
  sourceUrl?: string | null;
}

const HEX = /^#[0-9a-f]{6}$/i;
const clean = (xs?: string[] | null) => Array.from(new Set((xs || []).map((c) => String(c).trim().toLowerCase()).filter((c) => HEX.test(c)))).slice(0, 4);

/** Manual colours always win and are never replaced by derived ones. */
export function resolveBrand(i: BrandInputs): { colors: string[]; colorSource: ColorSource; logoUrl: string | null; logoSource: string | null; sourceUrl: string | null } {
  const order: Array<[ColorSource, string[] | null | undefined]> = [['manual', i.manualColors], ['logo', i.logoColors], ['website', i.websiteColors], ['theme', i.themeColors]];
  for (const [src, xs] of order) {
    const c = clean(xs);
    if (c.length) return { colors: c, colorSource: src, logoUrl: i.logoUrl ?? null, logoSource: i.logoSource ?? null, sourceUrl: src === 'website' || src === 'theme' ? i.sourceUrl ?? null : null };
  }
  return { colors: NEUTRAL_COLORS, colorSource: 'default', logoUrl: i.logoUrl ?? null, logoSource: i.logoSource ?? null, sourceUrl: null };
}

// ── Image source ──────────────────────────────────────────────────────────

export type ImageSource =
  | { kind: 'customer_photo'; assetId: string; url: string }
  | { kind: 'website_image'; url: string; sourceUrl?: string }
  | { kind: 'generate' }
  | { kind: 'branded_graphic' };

export function chooseImageSource(slot: PlannedSlot, opts: {
  customerPhotos: Array<{ id: string; url: string }>;
  /** Photos already used in recent posts (least-recently-used rotation). */
  recentlyUsedPhotoIds: string[];
  websiteImages: Array<{ url: string; sourceUrl?: string }>;
  offerImageId?: string | null;
  imageGenerationAvailable: boolean;
}): ImageSource {
  if (slot.purpose === 'offer' && opts.offerImageId) {
    const p = opts.customerPhotos.find((x) => x.id === opts.offerImageId);
    if (p) return { kind: 'customer_photo', assetId: p.id, url: p.url };
  }
  if (slot.purpose !== 'festival') {
    const fresh = opts.customerPhotos.filter((p) => !opts.recentlyUsedPhotoIds.includes(p.id));
    const pick = fresh[0] || opts.customerPhotos[slot.slot % Math.max(1, opts.customerPhotos.length)];
    if (pick) return { kind: 'customer_photo', assetId: pick.id, url: pick.url };
    if (slot.purpose !== 'offer' && opts.websiteImages[0]) return { kind: 'website_image', ...opts.websiteImages[(slot.slot - 1) % opts.websiteImages.length] };
  }
  return opts.imageGenerationAvailable ? { kind: 'generate' } : { kind: 'branded_graphic' };
}

/** Prompt for a generated image: the verified subject only, no invented scenes, claims or text. */
export function buildImagePrompt(slot: PlannedSlot, f: ContentFacts, colors: string[]): string {
  const subject = slot.purpose === 'festival' && slot.festival
    ? `a tasteful ${slot.festival.name} festive design (traditional ${slot.festival.name} symbols and decorations)`
    : slot.purpose === 'offer'
      ? `a clean promotional background for a ${f.category || 'local business'}`
      : `a clean, professional conceptual image representing ${slot.service || f.category || 'a local business'}`;
  return [
    `Create ${subject}.`,
    `Use the brand colours ${colors.join(', ')}.`,
    'Modern, uncluttered, suitable for a Google Business Profile post.',
    'Do NOT include any text, numbers, prices, discounts, logos, certificates, awards, ratings, statistics, before/after comparisons, or identifiable customers or staff.',
    'Do not depict a specific finished project or a real office — keep it illustrative.',
  ].join(' ');
}
