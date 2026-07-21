/**
 * Next.js instrumentation hook — `register()` runs once per server process at
 * startup, before any request is handled. We use it to validate environment
 * configuration so a broken production deploy fails at boot instead of silently
 * serving customers with localhost links, test payment keys, or missing secrets.
 */
export async function register() {
  // Only the Node.js server runtime has access to secrets / process.env; skip
  // the edge runtime where this would run with a restricted environment.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('@/lib/env');
    validateEnv();
  }
}
