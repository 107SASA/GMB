import { readPhotosAsJson, type CardImage } from '@/services/crm/businessCardScan';
import { sanitizeMenuDraft, type MenuDraft } from '@/services/gbp/changes/richSections';

/**
 * Menu photo(s) → menu draft for Google (sections → items → price, veg,
 * spice). Nothing is written here: the owner checks the draft and approves.
 */

const MENU_PROMPT = `You are reading photos of ONE restaurant / café / sweet shop menu (often Indian).
Return every dish exactly as printed, grouped under the menu's own section headings
(e.g. "Starters", "Main Course", "Breads", "Beverages"). Rules:
- name: the dish name as printed, in Title Case. Never invent dishes.
- price: the number only (no currency symbol). If a dish has several prices (half/full, small/large), use the FIRST (smallest) one. null if no price is printed.
- veg: true when the menu marks it vegetarian (green dot, "veg" section, "(V)"), false when marked non-veg (red/brown dot, chicken, mutton, fish, egg), null when unclear.
- spice: "MILD", "MEDIUM" or "HOT" only when the menu shows chillies / says spicy; otherwise null.
- description: a short line only when the menu prints one; otherwise empty.
- currency: ISO code of the printed currency (₹ / Rs → "INR").
If a photo is not a menu, return no sections.`;

const MENU_SCHEMA = {
  type: 'OBJECT',
  properties: {
    currency: { type: 'STRING' },
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                description: { type: 'STRING' },
                price: { type: 'NUMBER', nullable: true },
                veg: { type: 'BOOLEAN', nullable: true },
                spice: { type: 'STRING', nullable: true, enum: ['MILD', 'MEDIUM', 'HOT'] },
              },
              required: ['name'],
            },
          },
        },
        required: ['name', 'items'],
      },
    },
  },
  required: ['sections'],
};

export async function scanMenuPhotos(images: CardImage[], ctx: { userId: string; businessId: string }): Promise<MenuDraft> {
  const { parsed } = await readPhotosAsJson(images, {
    prompt: MENU_PROMPT,
    schema: MENU_SCHEMA,
    // A full menu is long; 4 dense photos ≈ 300 dishes.
    maxOutputTokens: 16_384,
    timeoutMs: 90_000,
    promptType: 'menu_scan',
    isWeak: (p) => !Array.isArray((p as any)?.sections) || (p as any).sections.length === 0,
  }, ctx);
  return sanitizeMenuDraft(parsed, 'INR');
}
