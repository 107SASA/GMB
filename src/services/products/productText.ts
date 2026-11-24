/**
 * Product post wording. Pure: no I/O, no `@/` imports (unit-tested).
 * Google posts must not carry phone numbers or links in the text (the button
 * carries the link), and promotional superlatives get posts rejected.
 */

const URLISH = /(https?:\/\/\S+|www\.\S+|\b[\w-]+\.(com|in|net|org|co|io|shop|store)\b\S*)/gi;
const PHONE = /(\+?\d[\d\s-]{7,}\d)/g;
const PROMO = /\b(best|cheapest|no\.?\s*1|number\s*1|#1|guaranteed|world[- ]class)\b/gi;

export function cleanPostText(text: string): string {
  return String(text || '')
    .replace(URLISH, '')
    .replace(PHONE, '')
    .replace(PROMO, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!])/g, '$1')
    .trim();
}

export function formatPrice(price: number | null | undefined, currency = 'INR'): string | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  const n = Number.isInteger(price) ? price.toLocaleString('en-IN') : price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'INR' ? `₹${n}` : `${currency} ${n}`;
}

const BUTTON_LINE: Record<string, string> = {
  ORDER: 'Tap “Order online” to order.',
  SHOP: 'Tap “Buy” to shop now.',
  LEARN_MORE: 'Tap “Learn more” for details.',
  CALL: 'Tap “Call now” to order.',
};

/** Title + body of a product post (≤1500 characters together). */
export function productPostText(p: {
  name: string;
  category?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string;
  button?: string;
}, biz: { name?: string | null; city?: string | null }): { title: string; content: string } {
  const price = formatPrice(p.price ?? null, p.currency || 'INR');
  const title = `${p.name}${price ? ` — ${price}` : ''}`.slice(0, 120);
  const desc = cleanPostText(p.description || '');
  const where = biz.name ? `Available at ${biz.name}${biz.city ? `, ${biz.city}` : ''}.` : '';
  const content = [desc, where, BUTTON_LINE[p.button || 'LEARN_MORE'] || ''].filter(Boolean).join('\n\n').slice(0, 1300);
  return { title, content: content || p.name };
}

/** Spacing for a batch: the first soon, then one every `gapDays` (never a burst of posts). */
export function batchSchedule(count: number, now: Date, gapDays = 2): Date[] {
  const first = new Date(now.getTime() + 10 * 60 * 1000);
  return Array.from({ length: count }, (_, i) => new Date(first.getTime() + i * gapDays * 24 * 60 * 60 * 1000));
}

/** Weekly rotation: the product that has gone longest without a post (never-posted first). */
export function nextProductToPost<T extends { lastPostedAt?: Date | string | null; scheduledPostAt?: Date | string | null; createdAt?: Date | string }>(
  products: T[],
  now: Date,
): T | null {
  const waiting = products.some((p) => p.scheduledPostAt && new Date(p.scheduledPostAt) > now);
  if (waiting) return null;
  const sorted = [...products].sort((a, b) => {
    const ta = a.lastPostedAt ? new Date(a.lastPostedAt).getTime() : 0;
    const tb = b.lastPostedAt ? new Date(b.lastPostedAt).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  });
  return sorted[0] ?? null;
}

export type ProductButtonType = 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'CALL';
const BUTTONS = new Set(['ORDER', 'SHOP', 'LEARN_MORE', 'CALL']);

/** Owner / AI input → a clean product (null + reason when it can't be saved). */
export function sanitizeProductInput(raw: any, defaults: { website?: string | null; currency?: string } = {}): { ok: true; product: {
  name: string; category: string; description: string; price: number | null; currency: string; imageUrl: string | null; button: ProductButtonType; buttonUrl: string | null;
} } | { ok: false; error: string } {
  const name = String(raw?.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (name.length < 2) return { ok: false, error: 'Every product needs a name.' };
  const priceRaw = raw?.price;
  const price = priceRaw === null || priceRaw === undefined || priceRaw === '' ? null : Number(String(priceRaw).replace(/[^0-9.]/g, ''));
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100_000_000)) return { ok: false, error: `Check the price of ${name}.` };
  const imageUrl = typeof raw?.imageUrl === 'string' && /^https:\/\//i.test(raw.imageUrl) ? raw.imageUrl : null;
  let button = (BUTTONS.has(String(raw?.button)) ? String(raw.button) : 'LEARN_MORE') as ProductButtonType;
  const website = defaults.website && /^https:\/\//i.test(defaults.website) ? defaults.website : null;
  let buttonUrl: string | null = typeof raw?.buttonUrl === 'string' && raw.buttonUrl.trim() ? raw.buttonUrl.trim() : null;
  if (buttonUrl && !/^https:\/\//i.test(buttonUrl)) return { ok: false, error: `The button link for ${name} must start with https://` };
  if (button !== 'CALL' && !buttonUrl) buttonUrl = website;
  // No page to send people to: the post still works with a Call button.
  if (button !== 'CALL' && !buttonUrl) button = 'CALL';
  return {
    ok: true,
    product: {
      name,
      category: String(raw?.category || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      description: cleanPostText(String(raw?.description || '')).slice(0, 600),
      price: price === null ? null : Math.round(price * 100) / 100,
      currency: /^[A-Z]{3}$/.test(String(raw?.currency || '')) ? String(raw.currency) : defaults.currency || 'INR',
      imageUrl,
      button,
      buttonUrl: button === 'CALL' ? null : buttonUrl,
    },
  };
}
