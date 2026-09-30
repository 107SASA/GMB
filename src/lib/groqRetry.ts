import { meter } from './providerMeter';

/**
 * Retry wrapper for Groq calls. The production Groq org is on the on-demand
 * tier (8,000 tokens/minute for openai/gpt-oss-120b — confirmed from a live
 * 429, Sep 2026); one audit's narrative + consultant calls can exceed that
 * within a minute, and concurrent free reports certainly will. A 429 used to
 * fail that report section outright ("couldn't be generated").
 *
 * Retries 429 and 5xx up to `retries` times, waiting the interval Groq asks
 * for ("Please try again in 8.4s") plus jitter, capped at `maxWaitMs`.
 */
export async function withGroqRetry<T>(fn: () => Promise<T>, opts: { retries?: number; maxWaitMs?: number; reason?: string } = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const maxWait = opts.maxWaitMs ?? 30_000;
  const reason = opts.reason ?? 'ai';
  for (let attempt = 0; ; attempt++) {
    try {
      const res: any = await fn();
      meter('groqCall', 1, reason);
      if (res?.usage) {
        meter('groqInputToken', Number(res.usage.prompt_tokens) || 0, reason);
        meter('groqOutputToken', Number(res.usage.completion_tokens) || 0, reason);
      }
      return res;
    } catch (err: any) {
      const status: number | undefined = err?.status ?? err?.response?.status;
      const retryable = status === 429 || (status != null && status >= 500);
      if (!retryable || attempt >= retries) throw err;
      const msg = String(err?.message || '');
      // The daily token quota (TPD) resets in minutes-to-hours — waiting
      // 3 × 30s only delays the report; fail now and let the caller degrade.
      if (/tokens per day|\(TPD\)/i.test(msg)) throw err;
      const m = msg.match(/try again in ([\d.]+)\s*(ms|s)\b/i);
      const asked = m ? Number(m[1]) * (m[2].toLowerCase() === 'ms' ? 1 : 1000) : 2000 * 2 ** attempt;
      const wait = Math.min(maxWait, asked + 250 + Math.floor(Math.random() * 750));
      console.warn(`[groqRetry] ${status} — retrying in ${Math.round(wait / 100) / 10}s (attempt ${attempt + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
