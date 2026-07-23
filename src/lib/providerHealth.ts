/**
 * External provider / API-token health for the super-admin System Health page.
 *
 * The point: surface metered credits (especially SerpApi searches, which power
 * BOTH review sync and audit map-rank/competitor data) BEFORE they hit zero and
 * silently break the live site. SerpApi is the only provider with an easy live
 * balance endpoint; for the rest we report whether the key is configured (and,
 * where it matters, test-vs-live) so nothing critical is silently missing.
 */

export type ProviderStatus = 'ok' | 'warning' | 'critical' | 'unconfigured' | 'error';

export interface ProviderHealth {
  key: string;
  name: string;
  /** What this key powers — so the admin knows the blast radius if it dies. */
  powers: string;
  status: ProviderStatus;
  detail: string;
  /** Present only for metered providers with a queryable balance (SerpApi). */
  usage?: { used: number; limit: number; left: number };
  /** Where the admin goes to top up / rotate the key. */
  actionUrl?: string;
}

async function fetchJson(url: string, timeoutMs = 6000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** Live SerpApi balance — the critical, metered dependency. */
async function serpApiHealth(): Promise<ProviderHealth> {
  const base: ProviderHealth = {
    key: 'serpapi',
    name: 'SerpApi',
    powers: 'Review sync + audit map rankings & competitors',
    status: 'unconfigured',
    detail: 'SERPAPI_KEY is not set — review sync and audit rankings run on mock/fallback data.',
    actionUrl: 'https://serpapi.com/dashboard',
  };

  const key = process.env.SERPAPI_KEY;
  if (!key) return base;

  try {
    const { ok, status, body } = await fetchJson(
      `https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`
    );
    if (!ok) {
      return {
        ...base,
        status: 'error',
        detail: body?.error || `SerpApi account check failed (HTTP ${status}).`,
      };
    }

    const limit = Number(body.searches_per_month ?? 0);
    const left = Number(body.total_searches_left ?? body.plan_searches_left ?? 0);
    const used = Number(body.this_month_usage ?? Math.max(0, limit - left));

    // Warn once we're inside the last 10% of the plan (min 50 searches) so
    // there's runway to top up before reviews/audits start failing.
    const warnThreshold = Math.max(50, Math.floor(limit * 0.1));
    let statusLevel: ProviderStatus = 'ok';
    let detail = `${left.toLocaleString()} searches left this month (${used.toLocaleString()}/${limit.toLocaleString()} used).`;
    if (left <= 0) {
      statusLevel = 'critical';
      detail = `OUT OF SEARCHES — review sync and audit rankings are failing right now. Top up the SerpApi plan.`;
    } else if (left <= warnThreshold) {
      statusLevel = 'warning';
      detail = `Running low: only ${left.toLocaleString()} searches left this month. Top up soon to avoid an outage.`;
    }

    return { ...base, status: statusLevel, detail, usage: { used, limit, left } };
  } catch (err: any) {
    return {
      ...base,
      status: 'error',
      detail: err?.name === 'AbortError' ? 'SerpApi account check timed out.' : (err?.message || 'SerpApi account check failed.'),
    };
  }
}

/** Config-presence check for a provider that has no simple live balance API. */
function configured(
  key: string,
  name: string,
  powers: string,
  present: boolean,
  actionUrl?: string,
  extra?: { status?: ProviderStatus; detail?: string }
): ProviderHealth {
  return {
    key,
    name,
    powers,
    status: extra?.status ?? (present ? 'ok' : 'critical'),
    detail: extra?.detail ?? (present ? 'Configured.' : 'Not configured — this feature will not work.'),
    actionUrl,
  };
}

export async function getProviderHealth(): Promise<ProviderHealth[]> {
  const razorpayKey = process.env.RAZORPAY_KEY_ID || '';
  const razorpayIsTest = razorpayKey.startsWith('rzp_test_');
  const metaConfigured = Boolean(
    process.env.META_WHATSAPP_ACCESS_TOKEN && process.env.META_WHATSAPP_PHONE_NUMBER_ID
  );

  // SerpApi runs live; the rest are cheap synchronous config checks.
  const serpapi = await serpApiHealth();

  return [
    serpapi,
    configured('groq', 'Groq (AI)', 'All AI generation — audits, replies, content', Boolean(process.env.GROQ_API_KEY), 'https://console.groq.com'),
    configured('google_oauth', 'Google OAuth / GBP', 'Live Google Business Profile connection', Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), 'https://console.cloud.google.com/apis/credentials'),
    configured('google_maps', 'Google Maps API', 'Place autocomplete & business lookup', Boolean(process.env.GOOGLE_MAPS_API_KEY), 'https://console.cloud.google.com/apis/credentials'),
    configured('razorpay', 'Razorpay (billing)', 'Subscription checkout & webhooks', Boolean(razorpayKey && process.env.RAZORPAY_KEY_SECRET), 'https://dashboard.razorpay.com', {
      status: !razorpayKey ? 'critical' : razorpayIsTest ? 'warning' : 'ok',
      detail: !razorpayKey
        ? 'Not configured — customers cannot subscribe.'
        : razorpayIsTest
          ? 'Using TEST keys (rzp_test_…) — real payments will not be captured on the live site.'
          : 'Live keys configured.',
    }),
    configured('email', 'Email (Resend)', 'OTP, verification & transactional email', Boolean(process.env.RESEND_API_KEY), 'https://resend.com/api-keys'),
    configured('whatsapp', 'WhatsApp (Meta Cloud API)', 'Owner WhatsApp AI agent & notifications', metaConfigured, 'https://developers.facebook.com/apps', {
      status: metaConfigured ? 'ok' : 'warning',
      detail: metaConfigured ? 'Meta Cloud API configured.' : 'Meta keys empty — WhatsApp falls back to Twilio (or is inactive).',
    }),
  ];
}
