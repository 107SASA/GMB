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

/**
 * Weekly autopilot image source. Default: a NEW AI image made for this post.
 * A Photos-section photo is used ONLY when the owner explicitly chose it for
 * this post (e.g. the photo picked in the weekly offer question) — owning
 * photos never makes autopilot reuse them. If generation is unavailable the
 * approved fallback is a plain branded graphic — never a customer or website
 * photo picked on the owner's behalf.
 */
export type ImageSource =
  | { kind: 'customer_photo'; assetId: string; url: string }
  | { kind: 'generate' }
  | { kind: 'branded_graphic' };

/** Stored on each post: where its image came from (monthly report counts these). */
export type ImageOrigin = 'AI_GENERATED' | 'OWNER_SELECTED' | 'FALLBACK' | 'NONE';

export function chooseImageSource(slot: PlannedSlot, opts: {
  /** The owner's Photos (only used to resolve an explicit owner selection). */
  customerPhotos: Array<{ id: string; url: string }>;
  /** Photo the owner explicitly chose for the offer post. */
  offerImageId?: string | null;
  /** Photo the owner explicitly chose for this post ("Use this photo for this post"). */
  ownerSelectedPhotoId?: string | null;
  imageGenerationAvailable: boolean;
}): ImageSource {
  const explicit = opts.ownerSelectedPhotoId || (slot.purpose === 'offer' ? opts.offerImageId : null);
  if (explicit) {
    const p = opts.customerPhotos.find((x) => x.id === explicit);
    if (p) return { kind: 'customer_photo', assetId: p.id, url: p.url };
  }
  return opts.imageGenerationAvailable ? { kind: 'generate' } : { kind: 'branded_graphic' };
}

const clip = (s: string | null | undefined, n: number) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Prompt for a post's NEW image — built from the same context as the post
 * text (purpose, SEO theme, keyword, verified service/category, area,
 * verified description, the written post), so image and text show the same
 * topic. It may only illustrate the verified subject; it must not invent
 * evidence (projects, people, awards, ratings, offers, numbers, branches).
 */
export function buildImagePrompt(
  slot: PlannedSlot,
  f: ContentFacts,
  colors: string[],
  post?: { title?: string; body?: string } | null,
): string {
  const place = [f.area, f.city].filter(Boolean).join(', ');
  const subjectService = slot.service || f.category || 'a local business';
  const subject =
    slot.purpose === 'festival' && slot.festival
      ? `a tasteful ${slot.festival.name} greeting design with traditional ${slot.festival.name} symbols and decorations, with a subtle nod to a ${f.category || 'local business'}`
      : slot.purpose === 'offer'
        ? `a clean promotional visual for a ${f.category || 'local business'}${slot.service ? ` offering ${slot.service}` : ''}, with calm empty space where a short line of text can be placed`
        : `a realistic, professional scene that clearly represents ${subjectService}${f.category && slot.service ? ` (a ${f.category})` : ''}`;
  const context = [
    slot.seoTheme && `Post theme: ${slot.seoTheme}.`,
    slot.keyword && `The post targets the search "${slot.keyword}".`,
    place && `The business serves ${place}.`,
    post?.title && `Post headline: "${clip(post.title, 120)}".`,
    post?.body && `Post says: "${clip(post.body, 260)}".`,
    f.ownerDescription && `About the business (owner-provided): ${clip(f.ownerDescription, 200)}.`,
    slot.purpose === 'festival' && slot.festival && `Festival: ${slot.festival.name}.`,
  ].filter(Boolean).join(' ');
  return [
    `Create ${subject}.`,
    context,
    colors.length ? `Use the brand colours ${colors.join(', ')} as the main accent colours.` : '',
    'Square composition, modern and uncluttered, suitable for a Google Business Profile post. Leave the bottom-right corner visually quiet (a small logo is added there later).',
    'Do NOT include any text, letters, numbers, prices, discounts, percentages, logos, watermarks, certificates, awards, trophies, star ratings, statistics, charts, before/after comparisons, or signage with a business name.',
    'Do NOT show identifiable faces or present anyone as a real employee or customer; people, if any, must be anonymous (seen from behind, hands only, or out of focus).',
    'Do not depict a specific finished project, a real office or a branch — keep it illustrative of the service.',
  ].filter(Boolean).join(' ');
}
