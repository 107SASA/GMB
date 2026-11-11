/**
 * Services & Costs monitor — every third-party service the platform depends
 * on, in one place (super admin → Operations → Services & Costs).
 *
 * For each service we report, in order of trust:
 *   live     — read from the provider's own API (balance, quota, storage)
 *   logs     — counted from our own database (AI tokens, emails sent, audits)
 *   estimate — derived from our logs × list prices
 *   manual   — typed in by an admin (plan, cost, renewal date, limits)
 *
 * Status rules (worst one wins):
 *   usage ≥ warnPct of a limit → warning, ≥ critPct → critical
 *   prepaid balance below the low-balance threshold → warning, ≤ ⅓ of it → critical
 *   renewal in ≤ 30 days → warning, ≤ 7 days (or passed) → critical
 *
 * Server-only. Provider checks run in parallel, each with a timeout, and a
 * failing check never breaks the others.
 */
import os from 'node:os';
import fs from 'node:fs/promises';
import tls from 'node:tls';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import ServiceAccount, { type IServiceAccount, type IServiceMetric, type ServiceStatus } from '@/models/ServiceAccount';
import { sumServiceUse, utcDay } from '@/lib/serviceUsage';
import { UNIT_PRICES } from '@/services/audit/costModel';

export type { ServiceStatus, IServiceMetric };
export type BillingCycle = NonNullable<IServiceAccount['billingCycle']>;

export type ServiceCategory = 'Infrastructure' | 'Messaging & email' | 'Data & AI' | 'Payments' | 'Apps & code' | 'Domain';

export interface LimitDef {
  label: string;
  /** Default used until an admin overrides it; undefined = no limit until set. */
  value?: number;
  unit?: string;
}

interface CheckContext {
  limits: Record<string, number | undefined>;
  monthStart: Date;
}

interface CheckResult {
  status?: ServiceStatus;
  summary: string;
  metrics: IServiceMetric[];
  /** Usage cost observed this month (in addition to the plan cost, unless includesPlan). */
  spend?: { amount: number; currency: 'USD' | 'INR'; includesPlan?: boolean; source: IServiceMetric['source'] };
  /** A renewal/expiry date read from a live source (e.g. domain RDAP). */
  liveRenewalDate?: Date;
}

interface ServiceDef {
  key: string;
  name: string;
  category: ServiceCategory;
  powers: string;
  dashboardUrl?: string;
  defaults: { planName: string; billingCycle: BillingCycle; costAmount?: number; costCurrency?: 'USD' | 'INR'; notes?: string };
  limits?: Record<string, LimitDef>;
  check?: (ctx: CheckContext) => Promise<CheckResult>;
}

export interface ServiceReport {
  key: string;
  name: string;
  category: ServiceCategory;
  powers: string;
  dashboardUrl?: string;
  status: ServiceStatus;
  summary: string;
  metrics: IServiceMetric[];
  limits: Array<{ key: string; label: string; unit?: string; value?: number; isDefault: boolean }>;
  plan: {
    planName: string;
    billingCycle: BillingCycle;
    costAmount?: number;
    costCurrency: 'USD' | 'INR';
    renewalDate?: string;
    renewalSource?: 'live' | 'manual';
    daysToRenewal?: number;
    notes: string;
    alertsMuted: boolean;
  };
  spend?: CheckResult['spend'];
  checkedAt: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const RANK: Record<ServiceStatus, number> = { critical: 5, error: 4, warning: 3, unconfigured: 2, ok: 1, info: 0 };
export function worst(...s: Array<ServiceStatus | undefined>): ServiceStatus {
  return s.filter(Boolean).reduce<ServiceStatus>((a, b) => (RANK[b!] > RANK[a] ? b! : a), 'info');
}

const WARN_PCT = 80;
const CRIT_PCT = 95;

function usageStatus(used: number, limit?: number): ServiceStatus {
  if (!limit || limit <= 0) return 'ok';
  const pct = (used / limit) * 100;
  return pct >= CRIT_PCT ? 'critical' : pct >= WARN_PCT ? 'warning' : 'ok';
}

function balanceStatus(balance: number, low?: number): ServiceStatus {
  if (balance <= 0) return 'critical';
  if (!low) return 'ok';
  if (balance <= low / 3) return 'critical';
  return balance < low ? 'warning' : 'ok';
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const usd = (n: number) => `$${round(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inr = (n: number) => `₹${round(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (n: number, c: string) => (c === 'INR' ? inr(n) : c === 'USD' ? usd(n) : `${round(n)} ${c}`);
const GB = 1024 ** 3;
const MB = 1024 ** 2;

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

function notConfigured(what: string, critical = true): CheckResult {
  return { status: critical ? 'critical' : 'unconfigured', summary: `${what} not set — this service is not connected.`, metrics: [] };
}

/** The registrable domain the site runs on (growwmatics.com). */
function siteDomain(): string {
  const raw = process.env.SERVICE_MONITOR_DOMAIN || process.env.NEXT_PUBLIC_APP_URL || 'https://growwmatics.com';
  let host = raw;
  try { host = new URL(raw).hostname; } catch { /* plain host */ }
  // Local dev runs on localhost — still monitor the real domain.
  if (!host.includes('.') || /^[\d.]+$/.test(host)) return 'growwmatics.com';
  const parts = host.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : host;
}

// ── live checks ──────────────────────────────────────────────────────────────

async function readMemAvailable(): Promise<number | null> {
  try {
    const txt = await fs.readFile('/proc/meminfo', 'utf8');
    const m = txt.match(/MemAvailable:\s+(\d+)\s+kB/);
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

async function checkDigitalOcean(ctx: CheckContext): Promise<CheckResult> {
  const metrics: IServiceMetric[] = [];
  const notes: string[] = [];

  // The app runs on the droplet, so the droplet's own disk/RAM/CPU are local reads.
  try {
    const st = await fs.statfs('/');
    const total = st.blocks * st.bsize;
    const used = total - st.bavail * st.bsize;
    metrics.push({ label: 'Server disk', used: round(used / GB, 1), limit: round(total / GB, 1), unit: 'GB', status: usageStatus(used, total), source: 'live' });
  } catch { /* statfs unsupported */ }

  const totalMem = os.totalmem();
  const avail = (await readMemAvailable()) ?? os.freemem();
  const usedMem = totalMem - avail;
  metrics.push({ label: 'Server memory', used: round(usedMem / GB, 1), limit: round(totalMem / GB, 1), unit: 'GB', status: usageStatus(usedMem, totalMem), source: 'live' });

  const cores = os.cpus().length || 1;
  const load15 = os.loadavg()[2];
  const cpuPct = Math.round((load15 / cores) * 100);
  metrics.push({ label: 'CPU load (15 min avg)', value: `${cpuPct}% of ${cores} vCPU`, status: cpuPct >= 90 ? 'critical' : cpuPct >= 75 ? 'warning' : 'ok', source: 'live' });

  // Spaces bucket size vs the plan's included storage.
  const { isStorageConfigured, getBucketUsage } = await import('@/lib/storage');
  if (isStorageConfigured()) {
    try {
      const b = await getBucketUsage();
      const limitGb = ctx.limits.spacesGb;
      metrics.push({
        label: `Spaces storage (${b.objects.toLocaleString()}${b.partial ? '+' : ''} files)`,
        used: round(b.bytes / GB, 2), limit: limitGb, unit: 'GB',
        status: limitGb ? usageStatus(b.bytes / GB, limitGb) : 'ok', source: 'live',
      });
    } catch (e: any) {
      metrics.push({ label: 'Spaces storage', value: 'Check failed', status: 'error', source: 'live' });
      notes.push(`Spaces: ${e?.message || 'listing failed'}`);
    }
  } else {
    metrics.push({ label: 'Spaces storage', value: 'Not configured', status: 'warning', source: 'live' });
  }

  // Account bill so far, only with a read-only DigitalOcean API token.
  let spend: CheckResult['spend'];
  const token = process.env.DO_API_TOKEN;
  if (token) {
    try {
      const r = await fetchJson('https://api.digitalocean.com/v2/customers/my/balance', { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const mtd = Number(r.body.month_to_date_usage || 0);
        spend = { amount: mtd, currency: 'USD', includesPlan: true, source: 'live' };
        const budget = ctx.limits.monthlyBudgetUsd;
        metrics.push({ label: 'Bill so far this month', used: round(mtd), limit: budget, unit: 'USD', value: usd(mtd), status: budget ? usageStatus(mtd, budget) : 'ok', source: 'live' });
      } else {
        notes.push(`Billing API HTTP ${r.status}`);
      }
    } catch (e: any) {
      notes.push(`Billing API: ${e?.message}`);
    }
  } else {
    notes.push('Add DO_API_TOKEN (read-only) to see the month-to-date bill.');
  }

  const bad = metrics.filter((m) => m.status === 'warning' || m.status === 'critical').map((m) => m.label);
  return {
    summary: bad.length ? `Needs attention: ${bad.join(', ')}.${notes.length ? ' ' + notes.join(' ') : ''}` : `Server and storage healthy.${notes.length ? ' ' + notes.join(' ') : ''}`,
    metrics,
    spend,
  };
}

async function checkMongo(ctx: CheckContext): Promise<CheckResult> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) return { status: 'critical', summary: 'No database connection.', metrics: [] };
  const t0 = Date.now();
  await db.command({ ping: 1 });
  const pingMs = Date.now() - t0;
  const s: any = await db.stats();
  const bytes = Number(s.dataSize || 0) + Number(s.indexSize || 0);
  const limitMb = ctx.limits.storageMb;
  const st = usageStatus(bytes / MB, limitMb);
  return {
    summary: st === 'ok'
      ? `Connected (${pingMs} ms). ${round(bytes / MB, 1)} MB of data + indexes.`
      : `Storage is at ${limitMb ? Math.round((bytes / MB / limitMb) * 100) : '?'}% of the plan — upgrade the cluster tier before writes are blocked.`,
    metrics: [
      { label: 'Storage (data + indexes)', used: round(bytes / MB, 1), limit: limitMb, unit: 'MB', status: st, source: 'live' },
      { label: 'Collections', value: String(s.collections ?? '—'), source: 'live' },
      { label: 'Response time', value: `${pingMs} ms`, status: pingMs > 1500 ? 'warning' : 'ok', source: 'live' },
    ],
  };
}

async function checkInngest(ctx: CheckContext): Promise<CheckResult> {
  const hasKeys = Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY);
  if (!hasKeys) return notConfigured('INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY');
  const metrics: IServiceMetric[] = [];
  const used = ctx.limits.runsUsedThisMonth;
  const limit = ctx.limits.runsPerMonth;
  if (used != null) {
    metrics.push({ label: 'Runs this month (entered)', used, limit, unit: 'runs', status: usageStatus(used, limit), source: 'manual' });
  }
  return {
    status: 'ok',
    summary: 'Keys configured. Inngest has no usage API, so copy the run count from the Inngest billing page into the limits to track it here.',
    metrics,
  };
}

async function checkTwilio(ctx: CheckContext): Promise<CheckResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return notConfigured('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN');
  const auth = { headers: { Authorization: basic(sid, token) } };
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}`;
  const [bal, usage] = await Promise.all([
    fetchJson(`${base}/Balance.json`, auth),
    fetchJson(`${base}/Usage/Records/ThisMonth.json?Category=totalprice`, auth).catch(() => null),
  ]);
  if (!bal.ok) return { status: 'error', summary: bal.body?.message || `Twilio balance check failed (HTTP ${bal.status}).`, metrics: [] };
  const balance = Number(bal.body.balance);
  const currency = String(bal.body.currency || 'USD').toUpperCase();
  const st = balanceStatus(balance, ctx.limits.lowBalance);
  const metrics: IServiceMetric[] = [
    { label: 'Account balance', value: money(balance, currency), status: st, source: 'live' },
  ];
  let spend: CheckResult['spend'];
  const rec = usage?.ok ? usage.body?.usage_records?.[0] : null;
  if (rec) {
    const price = Number(rec.price || 0);
    metrics.push({ label: 'Spent this month (incl. Meta fees)', value: money(price, String(rec.price_unit || currency).toUpperCase()), source: 'live' });
    if (currency === 'USD' || currency === 'INR') spend = { amount: price, currency: currency as 'USD' | 'INR', source: 'live' };
  }
  return {
    summary: st === 'ok'
      ? `${money(balance, currency)} balance.`
      : st === 'critical'
        ? `Balance is ${money(balance, currency)} — WhatsApp messages will stop sending. Recharge Twilio now.`
        : `Balance is down to ${money(balance, currency)}. Recharge soon (or turn on auto-recharge).`,
    metrics,
    spend,
  };
}

async function checkDataForSeo(ctx: CheckContext): Promise<CheckResult> {
  const login = process.env.DATAFORSEO_LOGIN;
  const pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) return notConfigured('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD');
  const r = await fetchJson('https://api.dataforseo.com/v3/appendix/user_data', { headers: { Authorization: basic(login, pass) } });
  const result = r.body?.tasks?.[0]?.result?.[0];
  if (!r.ok || !result) return { status: 'error', summary: r.body?.status_message || `DataForSEO check failed (HTTP ${r.status}).`, metrics: [] };
  const balance = Number(result.money?.balance ?? 0);
  const st = balanceStatus(balance, ctx.limits.lowBalance);
  const metrics: IServiceMetric[] = [{ label: 'Prepaid balance', value: usd(balance), status: st, source: 'live' }];
  // money.statistics.day.total = API requests today; money.limits.day.total = the daily request cap.
  const reqToday = Number(result.money?.statistics?.day?.total);
  const reqCap = Number(result.money?.limits?.day?.total);
  if (Number.isFinite(reqToday)) {
    metrics.push({ label: 'API requests today', used: reqToday, limit: reqCap > 0 ? reqCap : undefined, unit: 'requests', status: reqCap > 0 ? usageStatus(reqToday, reqCap) : 'ok', source: 'live' });
  }
  if (Number.isFinite(Number(result.money?.total))) metrics.push({ label: 'Total topped up (all time)', value: usd(Number(result.money.total)), source: 'live' });
  return {
    summary: st === 'ok'
      ? `${usd(balance)} prepaid balance left.`
      : `Only ${usd(balance)} left — audits lose map rankings and keyword volumes when this hits zero. Top up.`,
    metrics,
  };
}

async function checkSerpApi(): Promise<CheckResult> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return notConfigured('SERPAPI_KEY');
  const r = await fetchJson(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`);
  if (!r.ok) return { status: 'error', summary: r.body?.error || `SerpApi check failed (HTTP ${r.status}).`, metrics: [] };
  const limit = Number(r.body.searches_per_month ?? 0);
  const left = Number(r.body.total_searches_left ?? r.body.plan_searches_left ?? 0);
  const used = Number(r.body.this_month_usage ?? Math.max(0, limit - left));
  const st: ServiceStatus = left <= 0 ? 'critical' : usageStatus(used, limit);
  return {
    summary: left <= 0
      ? 'OUT OF SEARCHES — review sync and audit rankings are failing. Upgrade or wait for the monthly reset.'
      : `${left.toLocaleString()} searches left this month${r.body.plan_name ? ` on ${r.body.plan_name}` : ''}.`,
    metrics: [{ label: 'Searches this month', used, limit, unit: 'searches', status: st, source: 'live' }],
  };
}

async function checkGroq(ctx: CheckContext): Promise<CheckResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return notConfigured('GROQ_API_KEY');
  const { default: AIUsageLog } = await import('@/models/AIUsageLog');
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const groq = { aiModel: { $regex: /groq|gpt-oss|llama|qwen|kimi/i } };
  const [keyCheck, todayAgg, monthAgg] = await Promise.all([
    fetchJson('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } }).catch(() => null),
    AIUsageLog.aggregate([{ $match: { ...groq, createdAt: { $gte: today } } }, { $group: { _id: null, tokens: { $sum: '$tokensUsed' }, calls: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } }]),
    AIUsageLog.aggregate([{ $match: { ...groq, createdAt: { $gte: ctx.monthStart } } }, { $group: { _id: null, tokens: { $sum: '$tokensUsed' }, cost: { $sum: '$estimatedCost' } } }]),
  ]);
  if (keyCheck && keyCheck.status === 401) return { status: 'critical', summary: 'Groq rejected the API key — all AI generation is failing. Rotate GROQ_API_KEY.', metrics: [] };
  const t = todayAgg[0] || { tokens: 0, calls: 0, failed: 0 };
  const m = monthAgg[0] || { tokens: 0, cost: 0 };
  const failRate = t.calls ? Math.round((t.failed / t.calls) * 100) : 0;
  const metrics: IServiceMetric[] = [
    { label: 'Tokens today', used: t.tokens, limit: ctx.limits.dailyTokens, unit: 'tokens', status: usageStatus(t.tokens, ctx.limits.dailyTokens), source: 'logs' },
    { label: 'Tokens this month', used: m.tokens, limit: ctx.limits.monthlyTokens, unit: 'tokens', status: usageStatus(m.tokens, ctx.limits.monthlyTokens), source: 'logs' },
    { label: 'Failed calls today', value: `${t.failed} of ${t.calls} (${failRate}%)`, status: t.calls >= 10 && failRate >= 20 ? 'warning' : 'ok', source: 'logs' },
  ];
  return {
    summary: failRate >= 20 && t.calls >= 10
      ? `${failRate}% of AI calls failed today — likely rate limits. Consider upgrading the Groq tier.`
      : `Key valid. ${t.calls.toLocaleString()} AI calls today.`,
    metrics,
    spend: { amount: round(m.cost, 4), currency: 'USD', source: 'estimate' },
  };
}

const GOOGLE_SKUS = ['googleTextSearch', 'googleGeocoding', 'googleDetailsLegacy', 'googleDetailsNewPro', 'googleDetailsNewEssentials'] as const;
const SKU_LABEL: Record<string, string> = {
  googleTextSearch: 'Text Search',
  googleGeocoding: 'Geocoding',
  googleDetailsLegacy: 'Place Details (legacy)',
  googleDetailsNewPro: 'Place Details (Pro)',
  googleDetailsNewEssentials: 'Place Details (Essentials)',
};

async function checkGoogleMaps(ctx: CheckContext): Promise<CheckResult> {
  if (!process.env.GOOGLE_MAPS_API_KEY) return notConfigured('GOOGLE_MAPS_API_KEY');
  const { default: Audit } = await import('@/models/Audit');
  const group: Record<string, any> = { _id: null, audits: { $sum: 1 } };
  for (const k of GOOGLE_SKUS) group[k] = { $sum: { $ifNull: [`$auditData.providerUsage.counts.${k}`, 0] } };
  const [agg] = await Audit.aggregate([
    { $match: { createdAt: { $gte: ctx.monthStart }, 'auditData.providerUsage.counts': { $exists: true } } },
    { $group: group },
  ]);
  const metrics: IServiceMetric[] = [];
  let overFreeUsd = 0;
  for (const k of GOOGLE_SKUS) {
    const used = Number(agg?.[k] || 0);
    const price = (UNIT_PRICES as any)[k] as { usd: number; freePerMonth?: number };
    const free = price.freePerMonth;
    if (free && used > free) overFreeUsd += (used - free) * price.usd;
    if (used > 0) metrics.push({ label: `${SKU_LABEL[k]} vs free tier`, used, limit: free, unit: 'calls', status: usageStatus(used, free) === 'critical' ? 'warning' : usageStatus(used, free), source: 'logs' });
  }
  const audits = Number(agg?.audits || 0);
  return {
    summary: overFreeUsd > 0
      ? `Past the free monthly allowance — about ${usd(overFreeUsd)} billable so far (audit calls only).`
      : `${audits} audits this month, within Google's free allowance. Counts audit calls only (not signup lookups) — confirm on the Cloud billing page.`,
    metrics: metrics.length ? metrics : [{ label: 'Audit calls this month', value: '0', source: 'logs' }],
    spend: { amount: round(overFreeUsd), currency: 'USD', source: 'estimate' },
  };
}

async function checkResend(ctx: CheckContext): Promise<CheckResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return notConfigured('RESEND_API_KEY');
  const monthDay = utcDay(ctx.monthStart);
  const [sentToday, sentMonth, domains] = await Promise.all([
    sumServiceUse('resend', utcDay()),
    sumServiceUse('resend', monthDay),
    fetchJson('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } }).catch(() => null),
  ]);
  const metrics: IServiceMetric[] = [
    { label: 'Emails today', used: sentToday, limit: ctx.limits.dailyEmails, unit: 'emails', status: usageStatus(sentToday, ctx.limits.dailyEmails), source: 'logs' },
    { label: 'Emails this month', used: sentMonth, limit: ctx.limits.monthlyEmails, unit: 'emails', status: usageStatus(sentMonth, ctx.limits.monthlyEmails), source: 'logs' },
  ];
  let status: ServiceStatus | undefined;
  let summary = `${sentMonth.toLocaleString()} emails sent this month.`;
  if (!process.env.RESEND_FROM_EMAIL) {
    status = 'warning';
    summary = 'RESEND_FROM_EMAIL is not set — emails go from the Resend sandbox and only reach your own address.';
  }
  if (domains?.ok && Array.isArray(domains.body?.data)) {
    const unverified = domains.body.data.filter((d: any) => d.status !== 'verified');
    metrics.push({ label: 'Sending domains', value: domains.body.data.map((d: any) => `${d.name} (${d.status})`).join(', ') || 'none', status: unverified.length ? 'critical' : 'ok', source: 'live' });
    if (unverified.length) {
      status = 'critical';
      summary = `Domain ${unverified.map((d: any) => d.name).join(', ')} is not verified — emails are failing. Fix DNS in Resend.`;
    }
  }
  return { status, summary, metrics };
}

async function checkRazorpay(ctx: CheckContext): Promise<CheckResult> {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) return notConfigured('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET');
  const isTest = id.startsWith('rzp_test_');
  const from = Math.floor(ctx.monthStart.getTime() / 1000);
  let captured = 0, fees = 0, tax = 0, count = 0, failed = 0, partial = false;
  for (let skip = 0; skip < 1000; skip += 100) {
    const r = await fetchJson(`https://api.razorpay.com/v1/payments?from=${from}&count=100&skip=${skip}`, { headers: { Authorization: basic(id, secret) } });
    if (!r.ok) return { status: 'error', summary: r.body?.error?.description || `Razorpay check failed (HTTP ${r.status}).`, metrics: [] };
    const items: any[] = r.body.items || [];
    for (const p of items) {
      if (p.status === 'captured' || p.status === 'refunded') {
        captured += Number(p.amount || 0); fees += Number(p.fee || 0); tax += Number(p.tax || 0); count += 1;
      } else if (p.status === 'failed') failed += 1;
    }
    if (items.length < 100) break;
    if (skip === 900) partial = true;
  }
  const feeInr = fees / 100;
  return {
    status: isTest ? 'warning' : 'ok',
    summary: isTest
      ? 'Using TEST keys — real customer payments are not being collected.'
      : `${count} payments this month; Razorpay kept ${inr(feeInr)} in fees (incl. ${inr(tax / 100)} GST).`,
    metrics: [
      { label: 'Collected this month', value: `${inr(captured / 100)} (${count}${partial ? '+' : ''} payments)`, source: 'live' },
      { label: 'Razorpay fees this month', value: inr(feeInr), source: 'live' },
      { label: 'Failed payments this month', value: String(failed), status: failed >= 5 ? 'warning' : 'ok', source: 'live' },
    ],
    spend: { amount: round(feeInr), currency: 'INR', source: 'live' },
  };
}

function certExpiry(host: string): Promise<Date | null> {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: host, timeout: 6000 }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      resolve(cert?.valid_to ? new Date(cert.valid_to) : null);
    });
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => { sock.destroy(); resolve(null); });
  });
}

async function checkDomain(): Promise<CheckResult> {
  const domain = siteDomain();
  const rdapBase = domain.endsWith('.com') || domain.endsWith('.net') ? 'https://rdap.verisign.com/com/v1' : 'https://rdap.org';
  const [rdap, cert] = await Promise.all([
    fetchJson(`${rdapBase}/domain/${encodeURIComponent(domain)}`, { headers: { Accept: 'application/rdap+json' } }).catch(() => null),
    certExpiry(domain),
  ]);
  const exp = rdap?.ok ? (rdap.body?.events || []).find((e: any) => e.eventAction === 'expiration')?.eventDate : null;
  const metrics: IServiceMetric[] = [];
  const days = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (cert) {
    const d = days(cert);
    metrics.push({ label: 'SSL certificate', value: `expires in ${d} days`, status: d <= 5 ? 'critical' : d <= 14 ? 'warning' : 'ok', source: 'live' });
  } else {
    metrics.push({ label: 'SSL certificate', value: 'Could not read', status: 'warning', source: 'live' });
  }
  return {
    summary: exp ? `${domain} registered until ${new Date(exp).toDateString()}.` : `Could not read the expiry date for ${domain} — enter it manually.`,
    metrics,
    liveRenewalDate: exp ? new Date(exp) : undefined,
  };
}

async function checkNanoBanana(ctx: CheckContext): Promise<CheckResult> {
  if (!process.env.NANOBANANA_API_KEY) return notConfigured('NANOBANANA_API_KEY', false);
  const month = await sumServiceUse('nanobanana', utcDay(ctx.monthStart));
  return {
    summary: `${month.toLocaleString()} images generated this month.`,
    metrics: [{ label: 'Images this month', used: month, limit: ctx.limits.monthlyImages, unit: 'images', status: usageStatus(month, ctx.limits.monthlyImages), source: 'logs' }],
  };
}

async function manualOnly(text: string): Promise<CheckResult> {
  return { status: 'ok', summary: text, metrics: [] };
}

// ── registry ─────────────────────────────────────────────────────────────────

export const SERVICES: ServiceDef[] = [
  {
    key: 'digitalocean', name: 'DigitalOcean (Droplet + Spaces)', category: 'Infrastructure',
    powers: 'The server the whole app runs on, plus media storage', dashboardUrl: 'https://cloud.digitalocean.com/account/billing',
    defaults: { planName: 'Droplet + Spaces', billingCycle: 'monthly', costCurrency: 'USD' },
    limits: { spacesGb: { label: 'Spaces included storage', value: 250, unit: 'GB' }, monthlyBudgetUsd: { label: 'Monthly budget', unit: 'USD' } },
    check: checkDigitalOcean,
  },
  {
    key: 'mongodb', name: 'MongoDB Atlas', category: 'Infrastructure',
    powers: 'The database — every customer, lead and report', dashboardUrl: 'https://cloud.mongodb.com',
    defaults: { planName: 'Atlas cluster', billingCycle: 'free', costCurrency: 'USD' },
    limits: { storageMb: { label: 'Cluster storage', value: 512, unit: 'MB' } },
    check: checkMongo,
  },
  {
    key: 'inngest', name: 'Inngest Cloud', category: 'Infrastructure',
    powers: 'Background jobs and crons — audits, follow-ups, publishing', dashboardUrl: 'https://app.inngest.com/billing',
    defaults: { planName: 'Hobby', billingCycle: 'free', costCurrency: 'USD' },
    limits: { runsPerMonth: { label: 'Runs included per month', unit: 'runs' }, runsUsedThisMonth: { label: 'Runs used (copy from Inngest)', unit: 'runs' } },
    check: checkInngest,
  },
  {
    key: 'twilio', name: 'Twilio (WhatsApp)', category: 'Messaging & email',
    powers: 'All WhatsApp messages, including Meta conversation fees', dashboardUrl: 'https://console.twilio.com/us1/billing/manage-billing/billing-overview',
    defaults: { planName: 'Pay as you go', billingCycle: 'prepaid', costCurrency: 'USD' },
    limits: { lowBalance: { label: 'Warn below balance', value: 20, unit: 'USD' } },
    check: checkTwilio,
  },
  {
    key: 'resend', name: 'Resend', category: 'Messaging & email',
    powers: 'OTP, billing and notification emails', dashboardUrl: 'https://resend.com/overview',
    defaults: { planName: 'Free', billingCycle: 'free', costCurrency: 'USD' },
    limits: { dailyEmails: { label: 'Emails per day', value: 100, unit: 'emails' }, monthlyEmails: { label: 'Emails per month', value: 3000, unit: 'emails' } },
    check: checkResend,
  },
  {
    key: 'dataforseo', name: 'DataForSEO', category: 'Data & AI',
    powers: 'Audit map rankings and keyword search volumes', dashboardUrl: 'https://app.dataforseo.com/api-dashboard',
    defaults: { planName: 'Prepaid', billingCycle: 'prepaid', costCurrency: 'USD' },
    limits: { lowBalance: { label: 'Warn below balance', value: 10, unit: 'USD' } },
    check: checkDataForSeo,
  },
  {
    key: 'serpapi', name: 'SerpApi', category: 'Data & AI',
    powers: 'Review sync and competitor lookups', dashboardUrl: 'https://serpapi.com/dashboard',
    defaults: { planName: 'Developer', billingCycle: 'monthly', costAmount: 75, costCurrency: 'USD' },
    check: checkSerpApi,
  },
  {
    key: 'groq', name: 'Groq', category: 'Data & AI',
    powers: 'All AI text — audits, replies, posts, agents', dashboardUrl: 'https://console.groq.com/settings/billing',
    defaults: { planName: 'Free', billingCycle: 'free', costCurrency: 'USD' },
    limits: { dailyTokens: { label: 'Tokens per day', unit: 'tokens' }, monthlyTokens: { label: 'Tokens per month', unit: 'tokens' } },
    check: checkGroq,
  },
  {
    key: 'google_maps', name: 'Google Cloud (Maps / Places)', category: 'Data & AI',
    powers: 'Business lookup, competitor search, geocoding', dashboardUrl: 'https://console.cloud.google.com/billing',
    defaults: { planName: 'Pay as you go', billingCycle: 'usage', costCurrency: 'USD' },
    check: checkGoogleMaps,
  },
  {
    key: 'nanobanana', name: 'NanoBanana', category: 'Data & AI',
    powers: 'AI images for posts', dashboardUrl: 'https://www.nananobanana.com',
    defaults: { planName: '', billingCycle: 'monthly', costCurrency: 'USD' },
    limits: { monthlyImages: { label: 'Images per month', unit: 'images' } },
    check: checkNanoBanana,
  },
  {
    key: 'razorpay', name: 'Razorpay', category: 'Payments',
    powers: 'Subscription checkout — charges a fee per transaction', dashboardUrl: 'https://dashboard.razorpay.com',
    defaults: { planName: 'Standard (per transaction)', billingCycle: 'usage', costCurrency: 'INR' },
    check: checkRazorpay,
  },
  {
    key: 'domain', name: 'Domain growwmatics.com', category: 'Domain',
    powers: 'The website, email sending domain and app links', dashboardUrl: undefined,
    defaults: { planName: 'Yearly registration', billingCycle: 'yearly', costCurrency: 'INR' },
    check: checkDomain,
  },
  {
    key: 'apple', name: 'Apple Developer Program', category: 'Apps & code',
    powers: 'iOS app on the App Store — the app is removed if this lapses', dashboardUrl: 'https://developer.apple.com/account',
    defaults: { planName: 'Individual / Organization', billingCycle: 'yearly', costAmount: 99, costCurrency: 'USD' },
    check: () => manualOnly('No API — set the renewal date to get reminders 30 and 7 days before.'),
  },
  {
    key: 'expo', name: 'Expo / EAS', category: 'Apps & code',
    powers: 'Mobile app builds and over-the-air updates', dashboardUrl: 'https://expo.dev',
    defaults: { planName: 'Free', billingCycle: 'free', costCurrency: 'USD', notes: 'Free plan has a monthly build limit — upgrade before a release crunch.' },
    check: () => manualOnly('No usage API used — check build credits on expo.dev before a release.'),
  },
  {
    key: 'google_play', name: 'Google Play Console', category: 'Apps & code',
    powers: 'Android app on the Play Store', dashboardUrl: 'https://play.google.com/console',
    defaults: { planName: 'One-time registration', billingCycle: 'one_time', costAmount: 25, costCurrency: 'USD' },
    check: () => manualOnly('Paid once — nothing to renew.'),
  },
  {
    key: 'github', name: 'GitHub', category: 'Apps & code',
    powers: 'Source code and deploys', dashboardUrl: 'https://github.com/settings/billing',
    defaults: { planName: 'Free', billingCycle: 'free', costCurrency: 'USD' },
    check: () => manualOnly('No API used — check Actions minutes and seats on the billing page if you upgrade.'),
  },
];

// ── run ──────────────────────────────────────────────────────────────────────

function nextRenewal(date: Date | undefined, cycle: BillingCycle): Date | undefined {
  if (!date) return undefined;
  if (cycle !== 'monthly') return date;
  // Monthly plans auto-charge: roll a past date forward to the next cycle.
  const d = new Date(date);
  while (d.getTime() < Date.now() - 86_400_000) d.setMonth(d.getMonth() + 1);
  return d;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} check timed out`)), ms))]);
}

export async function runServiceChecks(opts: { persist?: boolean } = {}): Promise<ServiceReport[]> {
  await dbConnect();
  const accounts = await ServiceAccount.find({}).lean<IServiceAccount[]>();
  const byKey = new Map(accounts.map((a) => [a.key, a]));
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

  const reports = await Promise.all(SERVICES.map(async (def): Promise<ServiceReport> => {
    const acc = byKey.get(def.key);
    const limitsOut: ServiceReport['limits'] = [];
    const limits: Record<string, number | undefined> = {};
    for (const [k, l] of Object.entries(def.limits || {})) {
      const override = acc?.limits?.[k];
      const value = typeof override === 'number' ? override : l.value;
      limits[k] = value;
      limitsOut.push({ key: k, label: l.label, unit: l.unit, value, isDefault: typeof override !== 'number' });
    }

    let res: CheckResult;
    try {
      res = def.check ? await withTimeout(def.check({ limits, monthStart }), 15_000, def.name) : { summary: '', metrics: [] };
    } catch (e: any) {
      res = { status: 'error', summary: e?.message || 'Check failed.', metrics: [] };
    }

    const cycle = (acc?.billingCycle || def.defaults.billingCycle) as BillingCycle;
    const renewal = res.liveRenewalDate || nextRenewal(acc?.renewalDate ? new Date(acc.renewalDate) : undefined, cycle);
    let renewalStatus: ServiceStatus | undefined;
    let daysToRenewal: number | undefined;
    let summary = res.summary;
    if (renewal) {
      daysToRenewal = Math.ceil((renewal.getTime() - Date.now()) / 86_400_000);
      if (daysToRenewal < 0) {
        renewalStatus = 'critical';
        summary = `Renewal date passed ${-daysToRenewal} days ago — confirm it renewed and update the date. ${summary}`;
      } else if (daysToRenewal <= 7) {
        renewalStatus = 'critical';
        summary = `Renews in ${daysToRenewal} day${daysToRenewal === 1 ? '' : 's'} — make sure the card on file works. ${summary}`;
      } else if (daysToRenewal <= 30) {
        renewalStatus = 'warning';
        summary = `Renews in ${daysToRenewal} days. ${summary}`;
      }
    } else if (cycle === 'yearly') {
      renewalStatus = 'unconfigured';
      if (!/renewal date/i.test(summary)) summary = `${summary} Add the renewal date to get reminders.`.trim();
    }

    const status = worst(res.status || 'ok', ...res.metrics.map((m) => m.status), renewalStatus);

    return {
      key: def.key,
      name: def.name,
      category: def.category,
      powers: def.powers,
      dashboardUrl: def.dashboardUrl,
      status: status === 'info' ? 'ok' : status,
      summary: summary.trim(),
      metrics: res.metrics,
      limits: limitsOut,
      plan: {
        planName: acc?.planName || def.defaults.planName,
        billingCycle: cycle,
        costAmount: acc?.costAmount ?? def.defaults.costAmount,
        costCurrency: (acc?.costCurrency || def.defaults.costCurrency || 'USD') as 'USD' | 'INR',
        renewalDate: renewal?.toISOString(),
        renewalSource: res.liveRenewalDate ? 'live' : renewal ? 'manual' : undefined,
        daysToRenewal,
        notes: acc?.notes || def.defaults.notes || '',
        alertsMuted: Boolean(acc?.alertsMuted),
      },
      spend: res.spend,
      checkedAt: new Date().toISOString(),
    };
  }));

  if (opts.persist !== false) {
    await ServiceAccount.bulkWrite(reports.map((r) => ({
      updateOne: {
        filter: { key: r.key },
        update: { $set: { lastStatus: r.status, lastSummary: r.summary, lastMetrics: r.metrics, lastCheckedAt: new Date(r.checkedAt) } },
        upsert: true,
      },
    })));
  }
  return reports;
}

/** Plan cost per month for a report (yearly spread over 12), excluding usage. */
export function monthlyPlanCost(r: ServiceReport): number {
  const c = r.plan.costAmount || 0;
  if (r.spend?.includesPlan) return 0;
  if (r.plan.billingCycle === 'monthly') return c;
  if (r.plan.billingCycle === 'yearly') return c / 12;
  return 0;
}

export function isServiceKey(key: string): boolean {
  return SERVICES.some((s) => s.key === key);
}

export function serviceLimitKeys(key: string): string[] {
  return Object.keys(SERVICES.find((s) => s.key === key)?.limits || {});
}
