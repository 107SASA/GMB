/**
 * QA / staging outbound-send suppression — single switch for every external
 * channel a migration test can reach.
 *
 *   QA_SUPPRESS_OUTBOUND_SENDS=true   suppress WhatsApp (Twilio + Meta), push, email,
 *                                     and FAIL CLOSED for Calendar / Razorpay / OAuth mutations
 *   QA_SUPPRESS_WHATSAPP_SENDS=true   legacy flag: WhatsApp only (existing QA scripts)
 *
 * Safety model
 *  1. Never honoured in production. A process is "production-like" when
 *     NODE_ENV=production and APP_ENV is not `staging`/`qa`. In that case the
 *     flags are IGNORED (real sends proceed exactly as before) and an error
 *     is logged once, so a stray or copy-pasted flag can never silently
 *     swallow OTP emails, push or WhatsApp. A staging box that runs a
 *     production build must opt in with APP_ENV=staging.
 *  2. Simulated where that is safe (WhatsApp/push/email return success with a
 *     synthetic id). NOT simulated where a fake success would be a lie about
 *     money or third-party state (Google Calendar invites, Razorpay, Google
 *     OAuth revoke): those throw `SuppressedExternalOperation` — a hard
 *     boundary — so staging can never touch them even with live credentials.
 *  3. `suppressionBoundaryViolations()` reports live-looking credentials
 *     (rzp_live_*, GBP_LIVE_WRITES_ENABLED, ACCOUNT_PURGE_MODE=live) next to an
 *     active suppression flag; the worker refuses to start on any.
 *
 * Logging records channel + kind + count only — never recipients, payloads
 * or credentials. Flags are read at call time so tests can flip them.
 */
export type OutboundChannel = 'whatsapp' | 'push' | 'email';
export type ExternalOperation = 'calendar' | 'razorpay' | 'oauth';
type Counted = OutboundChannel | ExternalOperation;

const STAGING_APP_ENVS = new Set(['staging', 'qa']);

/** NODE_ENV=production without an explicit staging marker. */
export function isProductionLike(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' && !STAGING_APP_ENVS.has(String(env.APP_ENV || '').toLowerCase());
}

function flagRequested(channel: Counted, env: NodeJS.ProcessEnv): boolean {
  if (env.QA_SUPPRESS_OUTBOUND_SENDS === 'true') return true;
  return channel === 'whatsapp' && env.QA_SUPPRESS_WHATSAPP_SENDS === 'true';
}

let warnedIgnored = false;
let counters: Partial<Record<Counted, number>> = {};

/** True when sends on `channel` must NOT happen. Ignores the flags in production-like environments. */
export function isOutboundSuppressed(channel: Counted, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!flagRequested(channel, env)) return false;
  if (isProductionLike(env)) {
    if (!warnedIgnored && env === process.env) {
      warnedIgnored = true;
      console.error(
        '[outbound-suppression] QA suppression flag is set but this is a production-like environment ' +
          '(NODE_ENV=production, APP_ENV not staging): the flag is IGNORED and real sends are enabled. Remove it.'
      );
    }
    return false;
  }
  return true;
}

/** Returns true (and logs, rate-limited per channel) when the send must NOT happen. */
export function suppressOutbound(channel: OutboundChannel, kind: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isOutboundSuppressed(channel, env)) return false;
  const n = (counters[channel] = (counters[channel] ?? 0) + 1);
  if (n <= 3 || n % 100 === 0) {
    console.warn(`[outbound-suppressed] channel=${channel} kind=${kind} count=${n} (QA suppression is ON — nothing was sent)`);
  }
  return true;
}

export class SuppressedExternalOperation extends Error {
  readonly code = 'QA_SUPPRESSED';
  readonly operation: ExternalOperation;
  readonly kind: string;
  constructor(operation: ExternalOperation, kind: string) {
    super(`QA suppression: ${operation} operation "${kind}" is blocked in this environment`);
    this.name = 'SuppressedExternalOperation';
    this.operation = operation;
    this.kind = kind;
  }
}

/**
 * Hard boundary for external mutations that cannot be simulated (calendar
 * invites, Razorpay, Google OAuth revoke). Throws while suppression is active;
 * a no-op otherwise. Place it BEFORE the network call.
 */
export function guardExternalOperation(operation: ExternalOperation, kind: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!isOutboundSuppressed(operation, env)) return;
  const n = (counters[operation] = (counters[operation] ?? 0) + 1);
  if (n <= 3 || n % 100 === 0) {
    console.warn(`[outbound-suppressed] operation=${operation} kind=${kind} count=${n} (blocked: cannot be simulated safely)`);
  }
  throw new SuppressedExternalOperation(operation, kind);
}

/** Why an enabled suppression flag sits next to configuration that could reach real third parties. */
export function suppressionBoundaryViolations(env: NodeJS.ProcessEnv = process.env): string[] {
  const requested = env.QA_SUPPRESS_OUTBOUND_SENDS === 'true' || env.QA_SUPPRESS_WHATSAPP_SENDS === 'true';
  if (!requested) return [];
  const v: string[] = [];
  if (isProductionLike(env)) v.push('suppression flag set in a production-like environment (it is ignored)');
  if (/^rzp_live_/i.test(String(env.RAZORPAY_KEY_ID || ''))) v.push('RAZORPAY_KEY_ID is a LIVE key');
  if (env.GBP_LIVE_WRITES_ENABLED === 'true') v.push('GBP_LIVE_WRITES_ENABLED=true');
  if (String(env.ACCOUNT_PURGE_MODE || '').toLowerCase() === 'live') v.push('ACCOUNT_PURGE_MODE=live');
  return v;
}

export interface SuppressionSummary {
  /** A flag is present in the environment. */
  requested: boolean;
  /** Suppression is actually in effect for this process. */
  active: boolean;
  ignoredInProduction: boolean;
  violations: string[];
  /** Counts only — never payloads. */
  suppressed: Partial<Record<Counted, number>>;
}

export function suppressionSummary(env: NodeJS.ProcessEnv = process.env): SuppressionSummary {
  const requested = env.QA_SUPPRESS_OUTBOUND_SENDS === 'true' || env.QA_SUPPRESS_WHATSAPP_SENDS === 'true';
  const prod = isProductionLike(env);
  return {
    requested,
    active: requested && !prod,
    ignoredInProduction: requested && prod,
    violations: suppressionBoundaryViolations(env),
    suppressed: { ...counters },
  };
}

/** Test helper. */
export function _resetSuppressionCounters() {
  counters = {};
  warnedIgnored = false;
}
