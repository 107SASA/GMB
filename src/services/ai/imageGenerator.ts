const NANOBANANA_BASE = 'https://www.nananobanana.com/api/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_IMAGE_MODEL = 'gemini-2.0-flash-preview-image-generation';

/**
 * Generates a thumbnail image and returns a URL or data-URL.
 *
 * Key routing:
 *  - "nb_…"  → NanoBanana API (returns a hosted URL)
 *  - anything else → Google AI Studio / Gemini API (returns a base64 data-URL)
 *
 * When the user gets a NanoBanana key, just put it in NANOBANANA_API_KEY
 * and the routing switches automatically.
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
    return `data:${mimeType};base64,${b64}`;
  } catch (err: any) {
    console.error('Gemini thumbnail failed:', err.message);
    return null;
  }
}
