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
    // Loud, once-per-boot notice when QA send suppression is requested (or wrongly
    // present in production, where it is ignored). Names only — no values.
    const { suppressionSummary } = await import('@/lib/outboundSuppression');
    const sup = suppressionSummary();
    if (sup.requested) {
      console.warn(
        `[outbound-suppression] requested=${sup.requested} active=${sup.active} ignoredInProduction=${sup.ignoredInProduction}` +
          (sup.violations.length ? ` violations=${JSON.stringify(sup.violations)}` : '')
      );
    }
  }
}
