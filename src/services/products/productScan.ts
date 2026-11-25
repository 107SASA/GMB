import { readPhotosAsJson, type CardImage } from '@/services/crm/businessCardScan';

/**
 * One product photo → name, category, short description and (only when a
 * price tag is visible) the price. The owner checks it before saving.
 */
const PRODUCT_PROMPT = (biz: { name: string; category: string; city: string }) => `This is a photo of ONE product sold by "${biz.name}" (${biz.category || 'a local shop'}${biz.city ? ` in ${biz.city}` : ''}).
Return:
- name: the product as a shopper would search it, with brand and model/size if visible (e.g. "Bosch 1.5 Ton 5 Star Inverter AC", "Kaju Katli (500 g)"). Never invent a brand that is not visible.
- category: a short product category (e.g. "Air conditioners", "Sweets", "Sarees").
- description: 1–2 plain sentences (max 250 characters) about what it is and who it suits, based only on what is visible. No prices, phone numbers, links, or words like "best" / "cheapest".
- price: the number only, ONLY if a price tag or printed MRP is clearly visible; otherwise null.
If the photo shows no product, return an empty name.`;

const PRODUCT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    category: { type: 'STRING' },
    description: { type: 'STRING' },
    price: { type: 'NUMBER', nullable: true },
  },
  required: ['name'],
};

export async function scanProductPhoto(
  image: CardImage,
  biz: { name: string; category: string; city: string },
  ctx: { userId: string; businessId: string },
): Promise<{ name: string; category: string; description: string; price: number | null }> {
  const { parsed } = await readPhotosAsJson([image], {
    prompt: PRODUCT_PROMPT(biz),
    schema: PRODUCT_SCHEMA,
    maxOutputTokens: 512,
    promptType: 'product_scan',
    isWeak: (p) => !String((p as any)?.name || '').trim(),
  }, ctx);
  const p = (parsed || {}) as any;
  const price = typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0 ? p.price : null;
  return {
    name: String(p.name || '').trim().slice(0, 120),
    category: String(p.category || '').trim().slice(0, 80),
    description: String(p.description || '').trim().slice(0, 300),
    price,
  };
}
