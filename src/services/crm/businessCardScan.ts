import { normalizePhoneE164 } from '@/lib/phone';
import { logAIUsage } from '@/lib/logAIUsage';
import {
  CARD_PROMPT,
  CARD_RESPONSE_SCHEMA,
  needsFallback,
  pickCardModels,
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
 * Models are NOT hardcoded: Google retires them for new keys (2.5 Flash /
 * Flash-Lite now 404 "no longer available to new users"). The scanner lists
 * the models this key can call (cached 6 h) and uses the newest Flash-Lite,
 * retrying weak reads on the newest Flash. A 404 refreshes the list.
 *
 * Env:
 *   GEMINI_API_KEY                 – Google AI Studio key (falls back to NANOBANANA_API_KEY when that is a Google key)
 *   CARD_SCAN_MODEL                – optional: force the reader model
 *   CARD_SCAN_FALLBACK_MODEL       – optional: force the retry model ("" disables the retry)
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODELS_TTL_MS = 6 * 60 * 60 * 1000;

let modelCache: { at: number; primary: string | null; fallback: string | null } | null = null;

async function discoverModels(apiKey: string, force = false): Promise<{ primary: string | null; fallback: string | null }> {
  if (!force && modelCache && Date.now() - modelCache.at < MODELS_TTL_MS) return modelCache;
  const all: { name: string; supportedGenerationMethods?: string[] }[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const res = await fetch(`${GEMINI_BASE}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Gemini model list ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    const data: any = await res.json();
    all.push(...(data?.models ?? []));
    pageToken = data?.nextPageToken ?? '';
    if (!pageToken) break;
  }
  const picked = pickCardModels(all);
  modelCache = { at: Date.now(), ...picked };
  console.log(`[business-card/scan] models: reader=${picked.primary} retry=${picked.fallback}`);
  return modelCache;
}

async function resolveModels(apiKey: string, force = false): Promise<string[]> {
  const envPrimary = process.env.CARD_SCAN_MODEL;
  const envFallback = process.env.CARD_SCAN_FALLBACK_MODEL;
  const found = envPrimary && envFallback !== undefined ? null : await discoverModels(apiKey, force);
  const primary = envPrimary || found?.primary;
  const fallback = envFallback !== undefined ? envFallback : found?.fallback;
  if (!primary) throw new Error('No Gemini Flash model is available for this API key.');
  return [primary, ...(fallback && fallback !== primary ? [fallback] : [])];
}

class GeminiHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

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

/** One call; if the model rejects our "thinking off" setting, retry once without it. */
async function callGemini(model: string, images: CardImage[], apiKey: string) {
  try {
    return await callGeminiOnce(model, images, apiKey, true);
  } catch (e) {
    if (e instanceof GeminiHttpError && e.status === 400 && /thinking/i.test(e.message)) {
      return callGeminiOnce(model, images, apiKey, false);
    }
    throw e;
  }
}

async function callGeminiOnce(model: string, images: CardImage[], apiKey: string, withThinkingConfig: boolean) {
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
        ...(withThinkingConfig ? { thinkingConfig: thinkingConfig(model) } : {}),
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GeminiHttpError(res.status, `Gemini ${model} ${res.status}: ${body.slice(0, 300)}`);
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

  let models = await resolveModels(apiKey);
  let best: CardScanResult | null = null;
  let lastError: Error | null = null;
  let refreshed = false;

  for (let attempt = 0; attempt < models.length; attempt++) {
    const model = models[attempt];
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
      // Model retired since we looked it up → refresh the list once and start over.
      if (e instanceof GeminiHttpError && e.status === 404 && !refreshed) {
        refreshed = true;
        const fresh = await resolveModels(apiKey, true).catch(() => models);
        if (fresh.join() !== models.join()) {
          models = fresh;
          attempt = -1;
          continue;
        }
      }
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
