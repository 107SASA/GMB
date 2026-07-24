const NANOBANANA_BASE = 'https://www.nananobanana.com/api/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Google's current image model (nicknamed "Nano Banana"). The previous value,
// gemini-2.0-flash-preview-image-generation, was DEPRECATED and now returns
// 404 NOT_FOUND — which silently broke all thumbnail generation. Overridable
// via env so a future model rename needs no code change.
// NOTE: Gemini image generation requires BILLING enabled on the key's Google
// project; the free tier has effectively no image quota (429 RESOURCE_EXHAUSTED).
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

/**
 * Generates a thumbnail image and returns a URL or data-URL.
 *
 * Key routing (NANOBANANA_API_KEY):
 *  - "nb_…"  → NanoBanana API (returns a hosted URL)
 *  - "AQ.…" / "AIzaSy…" → Google AI Studio / Gemini API (returns a base64 data-URL)
 *
 * Whichever key you use, image generation is a PAID capability — a NanoBanana
 * plan, or a billing-enabled Google project. The routing switches automatically
 * based on the key prefix.
 */
export async function generateThumbnail(prompt: string): Promise<string | null> {
  const apiKey = process.env.NANOBANANA_API_KEY;
  if (!apiKey) {
    console.warn('NANOBANANA_API_KEY not set — skipping thumbnail generation');
    return null;
  }

  if (apiKey.startsWith('nb_')) {
    return generateWithNanoBanana(prompt, apiKey);
  }

  // Google AI Studio key (AQ.xxx / AIzaSy… formats)
  return generateWithGemini(prompt, apiKey);
}

// ─── NanoBanana ───────────────────────────────────────────────────────────────

async function generateWithNanoBanana(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(`${NANOBANANA_BASE}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt,
        selectedModel: 'nano-banana',
        mode: 'sync',
        aspectRatio: '16:9',
        quantity: 1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`NanoBanana error ${res.status}:`, await res.text());
      return null;
    }

    const data = await res.json();
    return (data.outputImageUrls as string[])?.[0] ?? null;
  } catch (err: any) {
    console.error('NanoBanana thumbnail failed:', err.message);
    return null;
  }
}

// ─── Google Gemini ────────────────────────────────────────────────────────────

async function generateWithGemini(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(
      `${GEMINI_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: `Generate a professional social media thumbnail image. ${prompt}` }],
          }],
          generationConfig: {
            responseModalities: ['IMAGE', 'TEXT'],
          },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`Gemini image error ${res.status}:`, await res.text());
      return null;
    }

    const data = await res.json();
    const imagePart = data.candidates?.[0]?.content?.parts?.find(
      (p: any) => p.inlineData?.data
    );

    if (!imagePart?.inlineData) return null;

    const { mimeType, data: b64 } = imagePart.inlineData;
    // Gemini returns full-size PNGs (~2 MB). Downscale to a web thumbnail so the
    // data-URL we store/ship is ~150 KB instead of megabytes.
    const compressed = await compressToThumbnail(b64);
    return compressed ?? `data:${mimeType};base64,${b64}`;
  } catch (err: any) {
    console.error('Gemini thumbnail failed:', err.message);
    return null;
  }
}

/**
 * Resizes a base64 image down to a web thumbnail JPEG data-URL using sharp
 * (bundled with Next.js). Falls back to null so callers keep the original if
 * sharp is unavailable or the input is unusual.
 */
async function compressToThumbnail(base64: string): Promise<string | null> {
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(Buffer.from(base64, 'base64'))
      .resize({ width: 1080, height: 1080, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch (err: any) {
    console.warn('[imageGenerator] thumbnail compression skipped:', err?.message);
    return null;
  }
}
