import { normalizePhoneE164 } from '@/lib/phone';
import { logAIUsage } from '@/lib/logAIUsage';
import {
  CARD_PROMPT,
  CARD_RESPONSE_SCHEMA,
  needsFallback,
  sanitizeCardExtraction,
  type CardFields,
} from './businessCardParse';

/**
 * Reads a visiting card photo with a Gemini vision model and returns clean
 * form fields. Nothing is saved here — the owner reviews the form and submits.
 *
 * Cost control: the cheap Flash-Lite model reads every card; only a weak
 * result (no contact found / unsure about name or phone) is retried once on
 * the stronger Flash model. "Thinking" is switched off (billed as output).
 *
 * Env:
 *   GEMINI_API_KEY                 – Google AI Studio key (falls back to NANOBANANA_API_KEY when that is a Google key)
 *   CARD_SCAN_MODEL                – default gemini-2.5-flash-lite
 *   CARD_SCAN_FALLBACK_MODEL       – default gemini-2.5-flash ("" disables the retry)
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const PRIMARY_MODEL = process.env.CARD_SCAN_MODEL || 'gemini-2.5-flash-lite';
const FALLBACK_MODEL = process.env.CARD_SCAN_FALLBACK_MODEL ?? 'gemini-2.5-flash';

export function geminiApiKey(): string | null {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const nb = process.env.NANOBANANA_API_KEY;
  // Same key routing as services/ai/imageGenerator.ts: non-"nb_" keys are Google keys.
  return nb && !nb.startsWith('nb_') ? nb : null;
}

export interface CardImage {
  data: Buffer;
  mimeType: string;
}

export interface CardScanResult {
  fields: CardFields;
  model: string;
}

function thinkingConfig(model: string) {
  // 2.x Flash/Flash-Lite: budget 0 = off. 3.x models use thinkingLevel instead.
  return /^gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' };
}

async function callGemini(model: string, images: CardImage[], apiKey: string) {
  const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            ...images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data.toString('base64') } })),
            { text: CARD_PROMPT },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema: CARD_RESPONSE_SCHEMA,
        thinkingConfig: thinkingConfig(model),
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini ${model} ${res.status}: ${body.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const text: string = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('');
  const usage = data?.usageMetadata ?? {};
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return {
    parsed,
    promptTokens: Number(usage.promptTokenCount) || 0,
    completionTokens: (Number(usage.candidatesTokenCount) || 0) + (Number(usage.thoughtsTokenCount) || 0),
  };
}

export async function scanBusinessCard(
  images: CardImage[],
  ctx: { userId: string; businessId: string },
): Promise<CardScanResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error('Card scanning is not configured (set GEMINI_API_KEY).');

  const models = [PRIMARY_MODEL, ...(FALLBACK_MODEL && FALLBACK_MODEL !== PRIMARY_MODEL ? [FALLBACK_MODEL] : [])];
  let best: CardScanResult | null = null;
  let lastError: Error | null = null;

  for (const [attempt, model] of models.entries()) {
    const promptType = attempt === 0 ? 'business_card_scan' : 'business_card_scan_retry';
    const started = Date.now();
    try {
      const r = await callGemini(model, images, apiKey);
      const fields = sanitizeCardExtraction(r.parsed, normalizePhoneE164);
      void logAIUsage({
        userId: ctx.userId,
        businessId: ctx.businessId,
        promptType,
        aiModel: model,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        status: r.parsed ? 'success' : 'partial',
        durationMs: Date.now() - started,
      });
      best = { fields, model };
      if (!needsFallback(fields)) break;
    } catch (e: any) {
      lastError = e;
      void logAIUsage({
        userId: ctx.userId,
        businessId: ctx.businessId,
        promptType,
        aiModel: model,
        status: 'failed',
        errorMessage: String(e?.message ?? e).slice(0, 500),
        durationMs: Date.now() - started,
      });
    }
  }
  if (!best) throw lastError ?? new Error('Card scan failed');
  return best;
}
