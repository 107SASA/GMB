/**
 * Environment validation — runs once at server boot (see src/instrumentation.ts).
 *
 * Goal: a misconfigured PRODUCTION deploy should fail loudly at startup instead
 * of silently breaking real customers (e.g. review links pointing at localhost,
 * test-mode Razorpay keys taking live payments, a weak/placeholder secret).
 *
 * Behaviour:
 *  - In production, a missing *required* secret throws (server refuses to boot).
 *  - Everything else is a WARNING printed to the logs — never crashes the app,
 *    so we don't turn a cosmetic misconfig into an outage.
 */

const isProd = process.env.NODE_ENV === 'production';

// Secrets whose absence guarantees breakage. Missing → refuse to boot in prod.
const REQUIRED_IN_PROD = [
  'MONGODB_URI',
  'SESSION_SECRET',
  'JWT_SECRET',
  'GOOGLE_TOKEN_SECRET',
];

function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  return (
    v.includes('yourdomain.com') ||
    v.includes('your_secret') ||
    v.includes('changeme') ||
    v.includes('replace-me')
  );
}

export function validateEnv(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Required secrets
  for (const key of REQUIRED_IN_PROD) {
    if (!process.env[key]) {
      (isProd ? errors : warnings).push(`Missing required env var: ${key}`);
    }
  }

  // 2. Secret strength (32+ chars). Short secrets weaken all auth tokens.
  for (const key of ['SESSION_SECRET', 'JWT_SECRET', 'NEXTAUTH_SECRET']) {
    const val = process.env[key];
    if (val && val.length < 32) {
      warnings.push(`${key} looks weak (<32 chars) — use \`openssl rand -hex 48\`.`);
    }
    if (isPlaceholder(val)) {
      (isProd ? errors : warnings).push(`${key} is empty or still a placeholder.`);
    }
  }
  // crypto.ts requires GOOGLE_TOKEN_SECRET to be exactly 64 hex chars (32 bytes).
  const tokenSecret = process.env.GOOGLE_TOKEN_SECRET;
  if (tokenSecret && !/^[0-9a-fA-F]{64}$/.test(tokenSecret)) {
    (isProd ? errors : warnings).push(
      'GOOGLE_TOKEN_SECRET must be exactly 64 hex chars (32 bytes) — see src/lib/crypto.ts.'
    );
  }

  // 3. Public URLs must be a real HTTPS domain in production. A localhost or
  //    placeholder value ships broken links to customers (WhatsApp/email).
  if (isProd) {
    for (const key of ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_BASE_URL', 'NEXTAUTH_URL', 'GOOGLE_REDIRECT_URI']) {
      const val = process.env[key];
      if (!val) {
        warnings.push(`${key} is not set — customer-facing links/redirects may break.`);
      } else if (val.includes('localhost') || val.startsWith('http://') || isPlaceholder(val)) {
        errors.push(`${key} must be your real HTTPS domain (got: ${val}).`);
      }
    }

    // 4. Billing: never run live with Razorpay test keys.
    const rzpKey = process.env.RAZORPAY_KEY_ID;
    if (rzpKey && rzpKey.startsWith('rzp_test_')) {
      warnings.push('RAZORPAY_KEY_ID is a TEST key — real payments will not be collected.');
    }

    // 5. Inngest dev flag must never be present in prod (flips SDK to dev URLs).
    if (process.env.INNGEST_DEV) {
      errors.push('INNGEST_DEV must be unset in production (its presence forces dev mode).');
    }
  }

  if (warnings.length) {
    console.warn('\n⚠️  [env] Configuration warnings:\n' + warnings.map((w) => `   - ${w}`).join('\n') + '\n');
  }
  if (errors.length) {
    const msg =
      '\n❌ [env] Invalid production configuration — refusing to start:\n' +
      errors.map((e) => `   - ${e}`).join('\n') +
      '\n';
    // Fail fast so a broken prod deploy is caught at boot, not by a customer.
    throw new Error(msg);
  }

  if (isProd) {
    console.log('✅ [env] Production environment validated.');
  }
}
