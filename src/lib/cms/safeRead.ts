/**
 * Runs a read for a PUBLIC page and falls back instead of failing.
 *
 * Public marketing pages are pre-built (static / ISR). If MongoDB is slow or
 * unreachable — during `next build` or a background rebuild — the page must
 * still render with its built-in copy, never error and never hang the build.
 */
export async function safeRead<T>(label: string, read: () => Promise<T>, fallback: T, timeoutMs = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[cms] ${label}: timed out after ${timeoutMs}ms — using built-in content`);
          resolve(fallback);
        }, timeoutMs);
      }),
    ]);
  } catch (err: any) {
    console.warn(`[cms] ${label}: ${err?.message || err} — using built-in content`);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
