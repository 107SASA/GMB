import crypto from 'crypto';
import { guardedFetchText } from '@/lib/ssrfGuard';
import { meter } from '@/lib/providerMeter';
import {
  extractPage,
  extractWebsiteFacts,
  normalizeOrigin,
  planCrawl,
  planFromSitemap,
  type ExtractedPage,
  type PageKind,
} from './websiteExtract';

/**
 * Controlled website research — crawl once, store, reuse.
 *
 *   homepage → about / services / contact / locations → up to 2 service pages
 *
 * Limits: max 6 pages (competitors: 2), same site only, 8s per page, 1.5 MB
 * per response, SSRF-guarded on every hop (lib/ssrfGuard.ts). The result is
 * stored in WebsiteIntelligence keyed by origin and reused for 30 days by
 * the free report, AI analysis, keyword discovery, onboarding prefill and
 * the connected audit. A crawl failure never fails the report — callers get
 * status 'failed' and carry on with other sources.
 */
export const WEBSITE_INTEL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const WEBSITE_INTEL_LOGIC_VERSION = 5;

export interface WebsiteIntelOptions {
  maxPages?: number;
  maxAgeMs?: number;
  force?: boolean;
}

async function fetchPage(url: string, kind: PageKind): Promise<(ExtractedPage & { kind: PageKind }) | null> {
  meter('websiteFetch', 1, `website_${kind}`);
  const res = await guardedFetchText(url, { timeoutMs: 8000, maxRedirects: 3, maxBytes: 1_500_000 });
  if (!res || !res.body) return null;
  return { ...extractPage(res.body, res.finalUrl), kind };
}

export async function crawlWebsite(rawUrl: string, maxPages = 6) {
  const origin = normalizeOrigin(rawUrl);
  if (!origin) return { origin: null, status: 'failed' as const, failureReason: 'invalid URL', pages: [] as any[], facts: null, homepageHash: undefined };
  const home = await fetchPage(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`, 'home');
  if (!home) {
    return { origin, status: 'failed' as const, failureReason: 'homepage did not respond', pages: [], facts: null, homepageHash: undefined };
  }
  let plan = planCrawl(home, maxPages);
  // Too few relevant pages linked from the homepage → try the sitemap (one
  // extra free GET), so a JS menu or single-page site is still researched.
  if (plan.length < Math.min(3, maxPages - 1)) {
    meter('websiteFetch', 1, 'website_sitemap');
    const sm = await guardedFetchText(`${origin}/sitemap.xml`, { timeoutMs: 6000, maxRedirects: 2, maxBytes: 1_000_000 });
    if (sm?.body) plan = [...plan, ...planFromSitemap(sm.body, home.url, [home.url, ...plan.map((p) => p.url)], maxPages - 1 - plan.length)];
  }
  const others = await Promise.all(plan.map((p) => fetchPage(p.url, p.kind).then((pg) => ({ plan: p, pg }))));
  const pages = [home, ...others.filter((o) => o.pg).map((o) => o.pg!)];
  const crawled = [
    { url: home.url, kind: 'home', status: 'ok' as const, title: home.title },
    ...others.map((o) => ({ url: o.plan.url, kind: o.plan.kind, status: (o.pg ? 'ok' : 'failed') as 'ok' | 'failed', title: o.pg?.title })),
  ];
  const facts = extractWebsiteFacts(pages);
  const homepageHash = crypto.createHash('sha256').update(home.text.slice(0, 20_000)).digest('hex');
  const status = others.every((o) => o.pg) ? 'complete' as const : 'partial' as const;
  return { origin, status, failureReason: undefined, pages: crawled, facts, homepageHash };
}

/**
 * Cached website intelligence for a URL: a fresh stored record is returned
 * as-is (no requests); otherwise the site is crawled and the record upserted.
 * Returns a plain object, or null when no URL / nothing usable.
 */
export async function getWebsiteIntelligence(rawUrl: string | undefined | null, opts: WebsiteIntelOptions = {}): Promise<any | null> {
  const origin = normalizeOrigin(String(rawUrl || ''));
  if (!origin) return null;
  const maxAge = opts.maxAgeMs ?? WEBSITE_INTEL_TTL_MS;
  let Model: any = null;
  try {
    Model = (await import('@/models/WebsiteIntelligence')).default;
    if (!opts.force) {
      const cached: any = await Model.findOne({ origin }).lean();
      const fresh = cached && cached.logicVersion === WEBSITE_INTEL_LOGIC_VERSION &&
        Date.now() - new Date(cached.fetchedAt).getTime() < maxAge &&
        // A failed or thin crawl is retried sooner than a good one.
        (cached.status !== 'failed' || Date.now() - new Date(cached.fetchedAt).getTime() < 24 * 60 * 60 * 1000) &&
        (opts.maxPages == null || (cached.crawlDepth ?? 0) >= opts.maxPages);
      if (fresh) {
        meter('websiteIntelCacheHit', 1, (opts.maxPages ?? 6) <= 2 ? 'competitor_website' : 'business_website');
        return cached;
      }
    }
  } catch (err: any) {
    console.warn('[websiteIntel] cache read skipped:', err?.message);
  }

  const crawl = await crawlWebsite(String(rawUrl), opts.maxPages ?? 6);
  const record = {
    origin,
    requestedUrl: String(rawUrl),
    status: crawl.status,
    failureReason: crawl.failureReason,
    pagesCrawled: crawl.pages,
    crawlDepth: opts.maxPages ?? 6,
    homepageHash: crawl.homepageHash,
    title: crawl.facts?.title,
    metaDescription: crawl.facts?.metaDescription,
    description: crawl.facts?.description,
    services: crawl.facts?.services ?? [],
    serviceAreas: crawl.facts?.serviceAreas ?? [],
    phones: crawl.facts?.phones ?? [],
    emails: crawl.facts?.emails ?? [],
    socialProfiles: crawl.facts?.socialProfiles ?? [],
    bookingLinks: crawl.facts?.bookingLinks ?? [],
    hours: crawl.facts?.hours ?? [],
    credentials: crawl.facts?.credentials ?? [],
    differentiators: crawl.facts?.differentiators ?? [],
    offers: crawl.facts?.offers ?? [],
    brand: crawl.facts?.brand ?? null,
    headings: crawl.facts?.headings ?? [],
    schemaTypes: crawl.facts?.schemaTypes ?? [],
    keywordsFound: crawl.facts?.keywordsFound ?? [],
    fetchedAt: new Date(),
    logicVersion: WEBSITE_INTEL_LOGIC_VERSION,
  };
  if (Model) {
    await Model.updateOne({ origin }, { $set: record }, { upsert: true })
      .catch((err: any) => console.warn('[websiteIntel] cache write skipped:', err?.message));
  }
  return record;
}
