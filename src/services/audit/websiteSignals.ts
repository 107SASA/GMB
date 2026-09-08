import axios from 'axios';

/**
 * A light read of the business's own website — homepage HTML + sitemap.xml,
 * nothing more. Feeds the "Full Audit Report" depth tier's website
 * assessment ("active, well-structured, 10+ service pages, FAQ, About Us").
 *
 * Two HTTP GETs, 8s timeout each, never throws. Result is stable per domain
 * so it's cached alongside the rank data in PlaceInsightCache.
 */

export interface WebsiteSignals {
  reachable: boolean;
  finalUrl?: string;
  title?: string;
  metaDescription?: string;
  /** Distinct internal URLs seen in the sitemap (capped). */
  pageCount?: number;
  /** Nav / body link labels that look like service or offering pages. */
  servicePages: string[];
  hasFaq: boolean;
  hasAbout: boolean;
  hasContact: boolean;
  hasPricing: boolean;
  hasBlog: boolean;
  socialLinks: string[];
  /** One-line human summary for the report + the LLM prompt. */
  structureNote: string;
}

const EMPTY: WebsiteSignals = {
  reachable: false,
  servicePages: [],
  hasFaq: false,
  hasAbout: false,
  hasContact: false,
  hasPricing: false,
  hasBlog: false,
  socialLinks: [],
  structureNote: 'No website on the listing, or it could not be reached.',
};

function normalizeUrl(raw: string): string | null {
  let u = (raw || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    return new URL(u).toString();
  } catch {
    return null;
  }
}

const SERVICE_HINT = /\b(service|treatment|course|program|package|solution|repair|fitting|test|consultation|therapy|training|class|menu|product|pricing|price|plan|offer)\b/i;
const SOCIAL_HOST = /(facebook|instagram|linkedin|youtube|twitter|x\.com|wa\.me|whatsapp|pinterest|t\.me)\b/i;

function textBetween(html: string, tag: string): string | undefined {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].replace(/\s+/g, ' ').trim() : undefined;
}

function metaContent(html: string, name: string): string | undefined {
  const m =
    html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
    html.match(new RegExp(`<meta[^>]+property=["']og:${name}["'][^>]+content=["']([^"']+)["']`, 'i'));
  return m ? m[1].trim() : undefined;
}

export async function fetchWebsiteSignals(websiteUrl?: string): Promise<WebsiteSignals> {
  const url = normalizeUrl(websiteUrl || '');
  if (!url) return EMPTY;

  let html = '';
  let finalUrl = url;
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 4,
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowwMaticsAudit/1.0)' },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    html = typeof res.data === 'string' ? res.data : '';
    finalUrl = res.request?.res?.responseUrl || url;
  } catch {
    return { ...EMPTY, structureNote: 'Website is on the listing but did not respond to a request.' };
  }

  const lower = html.toLowerCase();
  const title = textBetween(html, 'title');
  const metaDescription = metaContent(html, 'description');

  // Anchor labels + hrefs
  const anchors = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)).map((m) => ({
    href: m[1],
    label: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }));

  const servicePages = Array.from(
    new Set(
      anchors
        .filter((a) => a.label && a.label.length >= 3 && a.label.length <= 40)
        .filter((a) => SERVICE_HINT.test(`${a.label} ${a.href}`))
        .map((a) => a.label),
    ),
  ).slice(0, 20);

  const socialLinks = Array.from(
    new Set(anchors.map((a) => a.href).filter((h) => SOCIAL_HOST.test(h) && /^https?:\/\//i.test(h))),
  ).slice(0, 8);

  const has = (re: RegExp) => re.test(lower) || anchors.some((a) => re.test(a.label.toLowerCase()) || re.test(a.href.toLowerCase()));
  const hasFaq = has(/\bfaq\b|frequently asked/);
  const hasAbout = has(/about[-\s]?us|about\b/);
  const hasContact = has(/contact[-\s]?us|contact\b/);
  const hasPricing = has(/pricing|price list|fees|financ/);
  const hasBlog = has(/\bblog\b|\bnews\b|\barticles\b/);

  // sitemap page count (best-effort)
  let pageCount: number | undefined;
  try {
    const base = new URL(finalUrl);
    const sm = await axios.get(`${base.origin}/sitemap.xml`, { timeout: 6000, responseType: 'text' });
    const locs = String(sm.data).match(/<loc>/gi);
    if (locs) pageCount = Math.min(locs.length, 500);
  } catch {
    /* no sitemap — fine */
  }

  const bits: string[] = ['active'];
  if ((pageCount ?? 0) >= 8 || servicePages.length >= 5) bits.push('well-structured');
  if (servicePages.length) bits.push(`${servicePages.length}+ service pages`);
  const extras = [hasFaq && 'FAQ', hasAbout && 'About', hasContact && 'Contact', hasPricing && 'pricing/financing'].filter(Boolean);
  if (extras.length) bits.push(extras.join(', '));

  return {
    reachable: true,
    finalUrl,
    title,
    metaDescription,
    pageCount,
    servicePages,
    hasFaq,
    hasAbout,
    hasContact,
    hasPricing,
    hasBlog,
    socialLinks,
    structureNote: `Website ${bits.join(' · ')}.`,
  };
}
