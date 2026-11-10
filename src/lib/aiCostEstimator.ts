/**
 * Estimates AI API cost based on token usage and model.
 * Prices are per 1,000 tokens in USD (as of mid-2025).
 * Update these rates as pricing changes.
 */

interface TokenPricing {
  inputPer1k: number;
  outputPer1k: number;
}

const MODEL_PRICING: Record<string, TokenPricing> = {
  'gpt-4o':           { inputPer1k: 0.005,   outputPer1k: 0.015 },
  'gpt-4o-mini':      { inputPer1k: 0.000150, outputPer1k: 0.000600 },
  'gpt-3.5-turbo':    { inputPer1k: 0.0005,  outputPer1k: 0.0015 },
  'claude-3-5-sonnet':{ inputPer1k: 0.003,   outputPer1k: 0.015 },
  'gemini-pro':       { inputPer1k: 0.000125, outputPer1k: 0.000375 },
  // Visiting-card scan (services/crm/businessCardScan.ts). Image input is billed as input tokens.
  'gemini-2.5-flash-lite': { inputPer1k: 0.0001,  outputPer1k: 0.0004 },
  'gemini-2.5-flash':      { inputPer1k: 0.0003,  outputPer1k: 0.0025 },
  'gemini-3.1-flash-lite': { inputPer1k: 0.00025, outputPer1k: 0.0015 },
  'gemini-3.5-flash-lite': { inputPer1k: 0.0003,  outputPer1k: 0.0025 },
  'gemini-3.5-flash':      { inputPer1k: 0.0015,  outputPer1k: 0.009 },
  'gemini-3.8-flash':      { inputPer1k: 0.00075, outputPer1k: 0.00375 },
  'other':            { inputPer1k: 0.001,   outputPer1k: 0.002 },
};

const DEFAULT_PRICING: TokenPricing = { inputPer1k: 0.001, outputPer1k: 0.002 };

export function estimateAICost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  // Exact name first, then the longest known prefix ("gemini-3.8-flash-preview-…" → "gemini-3.8-flash").
  const prefix = Object.keys(MODEL_PRICING).filter((k) => model.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  const pricing = MODEL_PRICING[model] ?? (prefix ? MODEL_PRICING[prefix] : undefined) ?? DEFAULT_PRICING;
  const cost =
    (promptTokens / 1000) * pricing.inputPer1k +
    (completionTokens / 1000) * pricing.outputPer1k;
  return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimal precision
}

export function estimateAICostFromTotal(model: string, totalTokens: number): number {
  // Assume ~60% prompt / 40% completion split when breakdown unknown
  const promptTokens = Math.round(totalTokens * 0.6);
  const completionTokens = totalTokens - promptTokens;
  return estimateAICost(model, promptTokens, completionTokens);
}

export { MODEL_PRICING };
