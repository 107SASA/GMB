import * as Sentry from '@sentry/react-native';

/**
 * Crash/error reporting — a no-op until EXPO_PUBLIC_SENTRY_DSN is set (no
 * Sentry project has been provisioned for this app yet). Once it is, this
 * starts reporting with zero other code changes; RootLayout already wraps
 * itself with Sentry.wrap regardless, so navigation/render instrumentation
 * turns on for free at that point too.
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    tracesSampleRate: 0.2,
    enableAutoSessionTracking: true,
    debug: __DEV__,
  });
}
