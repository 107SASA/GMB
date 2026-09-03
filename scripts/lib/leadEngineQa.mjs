/**
 * Shared helpers for the automated Lead Engine QA scripts (lead-engine-e2e.mjs,
 * lead-engine-testkit.mjs). Everything here targets the DEDICATED local test
 * DB via resolveTestMongoUri() and the LOCAL dev server — never production.
 */
import mongoose from 'mongoose';
import { resolveTestMongoUri, loadLocalEnv, TEST_TENANT_ID } from './localTestEnv.mjs';

export { TEST_TENANT_ID };

export function appBaseUrl() {
  loadLocalEnv();
  return (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function inngestDevUrl() {
  loadLocalEnv();
  return (process.env.INNGEST_DEV_URL || 'http://localhost:8288').replace(/\/$/, '');
}

const APP_SLUG_PREFIX = 'gmb-optimization-platform-';

export async function connectTestDb() {
  const uri = resolveTestMongoUri();
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  return mongoose.connection.db;
}

export async function disconnectTestDb() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

/** POST JSON to a local app route. Throws only if the dev server is unreachable. */
export async function postJson(pathname, body) {
  const url = `${appBaseUrl()}${pathname}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch (err) {
    throw new Error(
      `Cannot reach the local dev server at ${appBaseUrl()} (${err.message}). ` +
      `Start "npm run dev" and keep "npx inngest-cli dev" running, then retry.`
    );
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

/** Fire an Inngest event (same path the real webhook uses). */
export async function sendInngestEvent(name, data) {
  const { Inngest } = await import('inngest');
  loadLocalEnv();
  const client = new Inngest({
    id: 'lead-engine-qa',
    isDev: process.env.INNGEST_DEV === '1' || !process.env.INNGEST_EVENT_KEY,
  });
  await client.send({ name, data });
}

/**
 * Directly invoke a cron-only Inngest function (nurture-scheduler-tick,
 * proactive-nba-scheduler) via the dev server's GraphQL invokeFunction
 * mutation. Returns true on accepted.
 */
export async function invokeInngestFunction(shortId, data = {}) {
  const slug = shortId.startsWith(APP_SLUG_PREFIX) ? shortId : APP_SLUG_PREFIX + shortId;
  const res = await fetch(`${inngestDevUrl()}/v0/gql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: 'mutation($fs:String!,$d:Map){ invokeFunction(functionSlug:$fs, data:$d) }',
      variables: { fs: slug, d: data },
    }),
  });
  const j = await res.json().catch(() => null);
  if (!j || j.errors || j.data?.invokeFunction !== true) {
    throw new Error(`invokeFunction(${slug}) failed: ${JSON.stringify(j)}`);
  }
  return true;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Compute the X-Twilio-Signature header for a form POST, exactly as
 * twilio.validateRequest verifies it: base64( HMAC-SHA1( authToken,
 * url + sorted(key+value) concatenated ) ). Lets the QA suite exercise the
 * REAL webhook path (signature check included) instead of bypassing it.
 */
export async function twilioSignature(url, params) {
  loadLocalEnv();
  const crypto = await import('node:crypto');
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) throw new Error('TWILIO_AUTH_TOKEN not in env — cannot sign the QA webhook request.');
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  return crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
}

/**
 * Poll `check` (async, returns truthy when the condition is met) until it
 * passes or the timeout elapses. Returns the last value from `check`.
 */
export async function waitFor(check, { timeoutMs = 20000, intervalMs = 750, label = 'condition' } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await check();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last; // caller asserts on the (falsy/partial) result and reports `label`
}

// ---- E.164 / phone helpers (mirror the testkit) ---------------------------
export function normE164(raw) {
  const t = String(raw).trim();
  const hasPlus = t.startsWith('+') || t.startsWith('00');
  let d = t.replace(/\D/g, '');
  if (t.startsWith('00')) d = d.slice(2);
  if (!d) return null;
  if (hasPlus) return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  d = d.replace(/^0+/, '');
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith('91')) return `+${d}`;
  return null;
}
export const last10 = (p) => String(p).replace(/\D/g, '').slice(-10);
export const oid = (v) => new mongoose.Types.ObjectId(v);

// ---- lightweight assertion harness --------------------------------------
export function makeHarness() {
  const results = [];
  return {
    results,
    /** Record a boolean assertion. */
    assert(name, cond, detail = '') {
      const ok = !!cond;
      results.push({ name, ok, detail });
      const tag = ok ? '  \x1b[32mPASS\x1b[0m' : '  \x1b[31mFAIL\x1b[0m';
      console.log(`${tag}  ${name}${detail ? `  — ${detail}` : ''}`);
      return ok;
    },
    /** Assert deep-ish equality. */
    assertEqual(name, actual, expected) {
      return this.assert(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    section(title) {
      console.log(`\n\x1b[1m${title}\x1b[0m`);
    },
    summary() {
      const passed = results.filter((r) => r.ok).length;
      const failed = results.length - passed;
      console.log(`\n${'='.repeat(70)}`);
      console.log(`RESULT: ${passed}/${results.length} assertions passed, ${failed} failed`);
      if (failed) {
        console.log('\nFailed:');
        for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
      }
      console.log('='.repeat(70));
      return failed === 0;
    },
  };
}
