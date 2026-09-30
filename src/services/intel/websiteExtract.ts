/**
 * Pure HTML extraction for website intelligence (no I/O, no `@/` imports —
 * runs under `node --test`). Every value returned is what the WEBSITE SAYS,
 * tagged with the page it came from: a SOURCE_CLAIM, not a verified fact.
 */

export interface Claim {
  value: string;
  sourceUrl: string;
}

export interface PageLink {
  href: string;
  label: string;
}

export interface ExtractedPage {
  url: string;
  title?: string;
  metaDescription?: string;
  canonical?: string;
  headings: string[];
  listItems: string[];
  links: PageLink[];
  jsonLd: any[];
  text: string;
  /** Brand signals from this page (homepage matters): theme colour, CSS colours, logo, share image. */
  brand?: PageBrand;
}

export interface PageBrand {
  themeColor?: string;
  cssColors: string[];
  logoUrl?: string;
  ogImage?: string;
  images: string[];
}

const HEX6 = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const expandHex = (h: string) => (h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h).toLowerCase();
/** Near-white, near-black and greys are layout colours, not brand colours. */
function isBrandish(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max - min > 40 && max > 40 && min < 235;
}

/** Brand colours / logo / share image, pure HTML parsing (no fetch). */
export function extractBrand(src: string, url: string): PageBrand {
  const abs = (u?: string) => (u ? normalizePageUrl(decode(u), url) || undefined : undefined);
  const theme = src.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-f]{3,6})["']/i)?.[1]
    || src.match(/<meta[^>]+content=["'](#[0-9a-f]{3,6})["'][^>]+name=["']theme-color["']/i)?.[1];
  const css = [
    ...Array.from(src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map((m) => m[1]),
    ...Array.from(src.matchAll(/style=["']([^"']*)["']/gi)).map((m) => m[1]),
  ].join(' ');
  const counts = new Map<string, number>();
  for (const m of css.match(HEX6) || []) {
    const h = expandHex(m);
    if (isBrandish(h)) counts.set(h, (counts.get(h) || 0) + 1);
  }
  // CSS custom properties named like brand colours win ties.
  for (const m of css.matchAll(/--[a-z-]*(primary|brand|accent|main)[a-z-]*\s*:\s*(#[0-9a-f]{3,6})/gi)) {
    const h = expandHex(m[2]);
    if (isBrandish(h)) counts.set(h, (counts.get(h) || 0) + 100);
  }
  const cssColors = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 4);
  const og = src.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || src.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
  const logoImg = src.match(/<img[^>]+(?:class|id|alt|src)=["'][^"']*logo[^"']*["'][^>]*>/i)?.[0];
  const logoSrc = logoImg?.match(/src=["']([^"']+)["']/i)?.[1];
  const images = Array.from(src.matchAll(/<img[^>]+src=["']([^"']+\.(?:jpe?g|png|webp))["'][^>]*>/gi))
    .map((m) => m[1]).filter((u) => !/logo|icon|sprite|avatar|pixel|badge/i.test(u)).slice(0, 6);
  return {
    themeColor: theme ? expandHex(theme) : undefined,
    cssColors,
    logoUrl: abs(logoSrc),
    ogImage: abs(og),
    images: images.map((u) => abs(u)).filter((u): u is string => !!u),
  };
}

export type PageKind = 'home' | 'about' | 'services' | 'service_detail' | 'contact' | 'locations' | 'pricing' | 'faq';

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, '-').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
const clean = (s: string) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Canonical origin for caching: https, lowercase host, no leading "www.". */
export function normalizeOrigin(raw: string): string | null {
  let u = String(raw || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const url = new URL(u);
    return `https://${url.hostname.toLowerCase().replace(/^www\./, '')}`;
  } catch {
    return null;
  }
}

/** Canonical page URL: no fragment, no tracking params, no trailing slash (except root). */
export function normalizePageUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    for (const p of Array.from(u.searchParams.keys())) if (/^(utm_|fbclid|gclid)/i.test(p)) u.searchParams.delete(p);
    let s = u.toString();
    if (u.pathname !== '/' && s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

export function sameSite(a: string, b: string): boolean {
  try {
    const h = (x: string) => new URL(x).hostname.toLowerCase().replace(/^www\./, '');
    return h(a) === h(b);
  } catch {
    return false;
  }
}

export function extractPage(html: string, url: string): ExtractedPage {
  const src = String(html || '');
  const noScript = src.replace(/<script(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const meta = (name: string) =>
    (src.match(new RegExp(`<meta[^>]+(?:name|property)=["'](?:og:)?${name}["'][^>]+content=["']([^"']*)["']`, 'i')) ||
      src.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:og:)?${name}["']`, 'i')))?.[1];
  const headings = Array.from(noScript.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)).map((m) => clean(m[2])).filter((t) => t.length >= 3 && t.length <= 120);
  const listItems = Array.from(noScript.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)).map((m) => clean(m[1])).filter((t) => t.length >= 3 && t.length <= 80);
  const links: PageLink[] = Array.from(noScript.matchAll(/<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi))
    .map((m) => ({ href: normalizePageUrl(decode(m[1]), url) || '', label: clean(m[2]) }))
    .filter((l) => !!l.href);
  const jsonLd: any[] = [];
  for (const m of src.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const flat = (x: any): any[] => (Array.isArray(x) ? x.flatMap(flat) : x && x['@graph'] ? flat(x['@graph']) : [x]);
      jsonLd.push(...flat(parsed).filter(Boolean));
    } catch { /* malformed JSON-LD is skipped */ }
  }
  const canonical = src.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
  return {
    url,
    title: clean(src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || undefined,
    metaDescription: meta('description') ? decode(meta('description')!).trim() : undefined,
    canonical: canonical ? normalizePageUrl(canonical, url) || undefined : undefined,
    headings,
    listItems,
    links,
    jsonLd,
    text: clean(noScript.replace(/<(header|nav|footer)[\s\S]*?<\/\1>/gi, ' ')).slice(0, 60_000),
    brand: extractBrand(src, url),
  };
}

const KIND_PATTERNS: Array<[PageKind, RegExp]> = [
  ['about', /\b(about|who we are|our story|company)\b/i],
  ['services', /\b(services|what we do|solutions|courses|programs?|products|treatments|offerings)\b/i],
  ['contact', /\b(contact|reach us|get in touch)\b/i],
  ['locations', /\b(locations?|branches|service areas?|areas we serve|find us)\b/i],
  ['pricing', /\b(pricing|prices|fees|packages|rate card|tariff)\b/i],
  ['faq', /\b(faqs?|frequently asked)\b/i],
];

export function classifyLink(link: PageLink): PageKind | null {
  let path = '';
  try { path = new URL(link.href).pathname.toLowerCase(); } catch { return null; }
  const hay = `${link.label} ${path.replace(/[-_/]/g, ' ')}`;
  for (const [kind, re] of KIND_PATTERNS) if (re.test(hay)) return kind;
  return null;
}

/** Links that are navigation or calls to action — never a service name. */
const NOT_A_SERVICE = /\b(home|about|contact|blog|news|faq|career|privacy|terms|login|log in|sign|register|book|booking|get|free|request|schedule|enquir\w*|inquir\w*|call|read more|learn more|view all|see all|click|apply|download|subscribe|our services|what we do|gallery|testimonials?|team|portfolio|menu|cart|shop now)\b/i;
/** Labels that start with a call to action ("Explore our programs", "Hire from us"). */
const CTA_START = /^\s*(explore|discover|view|see|check|hire|join|enrol+|enroll|apply|contact|get|learn|start|find|meet|watch|read|download|browse|visit|talk|chat|call|claim|grab|try|let'?s|why|how|what|who|welcome)\b/i;
/** Section / nav labels that are not a service on their own. */
const GENERIC_LABEL = /^\s*(our \s*)?(courses?|programs?|programmes?|placements?|interviews?|events?|upcoming events|products?|solutions?|careers?|clients?|partners?|resources?|features?|pricing|plans?|reviews?|awards?|achievements?|locations?|branches?|workshops?|webinars?|industries|technologies|process|overview|highlights|categories|more)\s*$/i;

/** A bare "Services" / "Our services" nav label — but "SEO Services" is a real service. */
const SERVICES_NAV = /^\s*(our\s+|all\s+|view\s+)?services\s*$/i;

/** "02 Website Development" → "Website Development". */
export function tidyServiceName(t: string): string {
  return String(t || '').replace(/^\s*\d{1,2}[.):]?\s+/, '').replace(/\s+/g, ' ').trim();
}

export function looksLikeServiceName(t: string): boolean {
  const s = tidyServiceName(t);
  // Taglines / sentences ("Automate the work. Keep the judgment.") are not services.
  if (/[.,;:]\s|\.$/.test(s) || /\bwhat we\b|\bwe (do|build|offer)\b/i.test(s)) return false;
  if (s.length < 3 || s.length > 60) return false;
  if (s.split(/\s+/).length > 7) return false;
  if (/[?!|©@]|https?:|\d{5,}/.test(s)) return false;
  if (NOT_A_SERVICE.test(s) || SERVICES_NAV.test(s) || CTA_START.test(s) || GENERIC_LABEL.test(s)) return false;
  return /[a-z]/i.test(s);
}

/** Pick the pages worth crawling (same site only), highest value first. */
export function planCrawl(home: ExtractedPage, maxPages = 6): Array<{ url: string; kind: PageKind }> {
  const picked: Array<{ url: string; kind: PageKind }> = [];
  const seen = new Set<string>([home.url]);
  const add = (url: string, kind: PageKind) => {
    if (picked.length >= maxPages - 1 || seen.has(url) || !sameSite(url, home.url)) return;
    if (/\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|docx?|xlsx?)(\?|$)/i.test(url)) return;
    seen.add(url);
    picked.push({ url, kind });
  };
  const byKind = new Map<PageKind, string>();
  for (const l of home.links) {
    const k = classifyLink(l);
    if (k && !byKind.has(k)) byKind.set(k, l.href);
  }
  for (const k of ['services', 'about', 'contact', 'locations', 'pricing', 'faq'] as PageKind[]) {
    const u = byKind.get(k);
    if (u) add(u, k);
  }
  // Service detail pages: links under the services path, or labelled like a service.
  const servicesUrl = byKind.get('services');
  const servicesPath = servicesUrl ? new URL(servicesUrl).pathname.replace(/\/$/, '') : null;
  for (const l of home.links) {
    let path = '';
    try { path = new URL(l.href).pathname; } catch { continue; }
    const underServices = servicesPath && path.startsWith(`${servicesPath}/`);
    if (underServices || (/\/(services?|courses?|treatments?|solutions?)\//i.test(path) && looksLikeServiceName(l.label))) add(l.href, 'service_detail');
  }
  return picked;
}

/**
 * Extra pages from sitemap.xml when the homepage links don't expose the
 * relevant pages (JS menus, single-page sites) — never assume /services
 * exists. Same site only, classified by URL path, within the page budget.
 */
export function planFromSitemap(xml: string, homeUrl: string, already: string[], remaining: number): Array<{ url: string; kind: PageKind }> {
  if (remaining <= 0) return [];
  const locs = (String(xml || '').match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || [])
    .map((m) => m.replace(/<\/?loc>/gi, '').trim())
    .filter((u) => sameSite(u, homeUrl) && !/\.(xml|pdf|jpe?g|png|gif|svg|webp|zip)(\?|$)/i.test(u));
  const have = new Set(already.map((u) => normalizePageUrl(u, homeUrl) || u));
  const byKind = new Map<PageKind, string>();
  const details: string[] = [];
  for (const raw of locs.slice(0, 500)) {
    const u = normalizePageUrl(raw, homeUrl);
    if (!u || have.has(u)) continue;
    const kind = classifyLink({ href: u, label: '' });
    if (kind && !byKind.has(kind)) byKind.set(kind, u);
    else if (/\/(services?|courses?|treatments?|solutions?)\/[^/]+/i.test(new URL(u).pathname)) details.push(u);
  }
  const out: Array<{ url: string; kind: PageKind }> = [];
  for (const k of ['services', 'about', 'contact', 'locations', 'pricing', 'faq'] as PageKind[]) {
    const u = byKind.get(k);
    if (u && out.length < remaining) out.push({ url: u, kind: k });
  }
  for (const u of details) if (out.length < remaining) out.push({ url: u, kind: 'service_detail' });
  return out;
}

const PHONE_RE = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)\d{3,5}[\s-]?\d{3,5}/g;
const SOCIAL_RE = /(facebook\.com|instagram\.com|linkedin\.com|youtube\.com|twitter\.com|x\.com|pinterest\.com|t\.me)\//i;
const BOOKING_RE = /(calendly\.com|book|appointment|schedule|reserv|wa\.me|api\.whatsapp\.com|practo|zocdoc|setmore|simplybook)/i;
const CREDENTIAL_RE = /\b(certified|accredited|licen[cs]ed|registered with|iso\s?\d{3,5}|award(ed|s)?|affiliated|approved by|recogni[sz]ed by|since \d{4}|established in \d{4}|\d{1,2}\+? years (of )?experience)\b/i;
/** Offers / promotions the site states (SOURCE_CLAIM — never shown as a GBP offer). */
const OFFER_RE = /\b(\d{1,2}\s?% off|discount|free trial|free demo|free consultation|special offer|limited[- ]time|combo offer|scholarship|emi available)\b/i;
const DIFFERENTIATOR_RE = /\b(why choose|what makes us|we are the only|specialis[e]?|speciali[sz]e|unique|guarantee|placement assistance|free consultation|24\/7|same[- ]day)\b/i;

function schemaNodes(pages: ExtractedPage[]): Array<{ node: any; url: string }> {
  return pages.flatMap((p) => p.jsonLd.map((node) => ({ node, url: p.url })));
}

/** Button / nav text that runs into sentences when a page has no <nav>. */
const CTA_PHRASES = /\b(book (a )?free consultation|explore (our )?services|get started|learn more|read more|contact us|get in touch|request a quote|view all|see all)\b/gi;

function sentencesMatching(pages: ExtractedPage[], re: RegExp, max: number): Claim[] {
  const out: Claim[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    for (const s of p.text.split(/(?<=[.!?])\s+/)) {
      const t = s.replace(CTA_PHRASES, ' ').replace(/\s+/g, ' ').trim();
      if (t.length < 20 || t.length > 220 || !re.test(t)) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ value: t, sourceUrl: p.url });
      if (out.length >= max) return out;
    }
  }
  return out;
}

function uniqClaims(items: Claim[], max: number): Claim[] {
  const seen = new Set<string>();
  const out: Claim[] = [];
  for (const c of items) {
    const k = c.value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ value: c.value.trim(), sourceUrl: c.sourceUrl });
    if (out.length >= max) break;
  }
  return out;
}

export interface WebsiteFacts {
  title?: string;
  metaDescription?: string;
  description?: Claim;
  services: Claim[];
  serviceAreas: Claim[];
  phones: Claim[];
  emails: Claim[];
  socialProfiles: Claim[];
  bookingLinks: Claim[];
  hours: Claim[];
  credentials: Claim[];
  differentiators: Claim[];
  offers: Claim[];
  headings: Claim[];
  schemaTypes: string[];
  keywordsFound: string[];
  /** Homepage brand signals (source = the homepage URL). */
  brand?: PageBrand & { sourceUrl: string };
}

/** Everything the crawled pages say, each item with its source page. */
export function extractWebsiteFacts(pages: Array<ExtractedPage & { kind: PageKind }>): WebsiteFacts {
  const home = pages.find((p) => p.kind === 'home') || pages[0];
  const schema = schemaNodes(pages);
  const types = Array.from(new Set(schema.map((s) => [].concat(s.node['@type'] || []).join('/')).filter(Boolean)));

  // Services: schema offers → services page headings/list items → service detail page titles.
  const services: Claim[] = [];
  for (const { node, url } of schema) {
    const types = [].concat(node['@type'] || []).join(' ');
    const listItems = /ItemList/i.test(types) ? ([].concat(node.itemListElement || []) as any[]) : [];
    for (const li of listItems) {
      const name = li?.item?.name || li?.name;
      if (name && looksLikeServiceName(String(name))) services.push({ value: tidyServiceName(String(name)), sourceUrl: url });
    }
    const offers = [].concat(node.makesOffer || [], node.hasOfferCatalog?.itemListElement || []) as any[];
    for (const o of offers) {
      const name = o?.itemOffered?.name || o?.name;
      if (name && looksLikeServiceName(String(name))) services.push({ value: String(name), sourceUrl: url });
    }
    if (/Service/i.test([].concat(node['@type'] || []).join(' ')) && node.name && looksLikeServiceName(String(node.name))) {
      services.push({ value: String(node.name), sourceUrl: url });
    }
  }
  // The site's own structured data is the most reliable list; headings and
  // list items are only used when it doesn't provide one.
  const fromSchema = services.length >= 2;
  if (!fromSchema) {
    for (const p of pages.filter((x) => x.kind === 'services')) {
      for (const h of p.headings.slice(1)) if (looksLikeServiceName(h)) services.push({ value: tidyServiceName(h), sourceUrl: p.url });
      for (const li of p.listItems) if (looksLikeServiceName(li) && li.split(/\s+/).length <= 5) services.push({ value: tidyServiceName(li), sourceUrl: p.url });
    }
  }
  for (const p of pages.filter((x) => x.kind === 'service_detail')) {
    const h1 = p.headings[0] || p.title?.split(/[|\-–]/)[0];
    if (h1 && looksLikeServiceName(h1)) services.push({ value: tidyServiceName(h1), sourceUrl: p.url });
  }

  const areas: Claim[] = [];
  for (const { node, url } of schema) {
    for (const a of [].concat(node.areaServed || []) as any[]) {
      const name = typeof a === 'string' ? a : a?.name;
      if (name) areas.push({ value: String(name), sourceUrl: url });
    }
  }
  for (const p of pages.filter((x) => x.kind === 'locations')) {
    for (const h of p.headings.slice(1)) if (h.split(/\s+/).length <= 4) areas.push({ value: h, sourceUrl: p.url });
  }

  const phones: Claim[] = [];
  const emails: Claim[] = [];
  const social: Claim[] = [];
  const booking: Claim[] = [];
  for (const p of pages) {
    for (const l of p.links) {
      if (/^tel:/i.test(l.href)) phones.push({ value: decodeURIComponent(l.href.replace(/^tel:/i, '')).trim(), sourceUrl: p.url });
      else if (/^mailto:/i.test(l.href)) emails.push({ value: l.href.replace(/^mailto:/i, '').split('?')[0].trim(), sourceUrl: p.url });
      else if (SOCIAL_RE.test(l.href) && !/\/(share|sharer|intent)/i.test(l.href)) social.push({ value: l.href, sourceUrl: p.url });
      else if (BOOKING_RE.test(`${l.href} ${l.label}`) && /^https?:/i.test(l.href) && /book|appointment|schedule|reserv|wa\.me|whatsapp|calendly/i.test(`${l.href} ${l.label}`)) {
        booking.push({ value: l.href, sourceUrl: p.url });
      }
    }
    if (p.kind === 'contact' || p.kind === 'home') {
      for (const m of p.text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []) emails.push({ value: m, sourceUrl: p.url });
    }
  }
  for (const { node, url } of schema) {
    if (node.telephone) phones.push({ value: String(node.telephone), sourceUrl: url });
    if (node.email) emails.push({ value: String(node.email).replace(/^mailto:/i, ''), sourceUrl: url });
    for (const s of [].concat(node.sameAs || []) as string[]) if (SOCIAL_RE.test(String(s))) social.push({ value: String(s), sourceUrl: url });
  }
  const phonesClean = phones
    .map((c) => ({ ...c, value: c.value.replace(/[^\d+]/g, '') }))
    .filter((c) => c.value.replace(/\D/g, '').length >= 8 && c.value.replace(/\D/g, '').length <= 15);
  void PHONE_RE;

  const hours: Claim[] = [];
  for (const { node, url } of schema) {
    for (const h of [].concat(node.openingHours || []) as any[]) if (typeof h === 'string') hours.push({ value: h, sourceUrl: url });
    for (const spec of [].concat(node.openingHoursSpecification || []) as any[]) {
      if (spec?.dayOfWeek && spec?.opens) hours.push({ value: `${[].concat(spec.dayOfWeek).map((d: any) => String(d).replace(/.*\//, '')).join(', ')} ${spec.opens}-${spec.closes}`, sourceUrl: url });
    }
  }

  const aboutPage = pages.find((p) => p.kind === 'about');
  const aboutPara = aboutPage?.text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 60 && s.length < 400).slice(0, 2).join(' ');
  const description: Claim | undefined = home?.metaDescription && home.metaDescription.length >= 40
    ? { value: home.metaDescription, sourceUrl: home.url }
    : aboutPara ? { value: aboutPara, sourceUrl: aboutPage!.url } : undefined;

  const svc = uniqClaims(services, 25);
  return {
    title: home?.title,
    metaDescription: home?.metaDescription,
    description,
    services: svc,
    serviceAreas: uniqClaims(areas, 15),
    phones: uniqClaims(phonesClean, 5),
    emails: uniqClaims(emails.filter((e) => /^[\w.+-]+@[\w-]+\.[a-z]{2,}(\.[a-z]{2,})?$/i.test(e.value) && !/\.(png|jpg|gif|webp)$/i.test(e.value)), 5),
    socialProfiles: uniqClaims(social, 8),
    bookingLinks: uniqClaims(booking, 5),
    hours: uniqClaims(hours, 10),
    credentials: sentencesMatching(pages, CREDENTIAL_RE, 6),
    differentiators: sentencesMatching(pages, DIFFERENTIATOR_RE, 6),
    offers: sentencesMatching(pages, OFFER_RE, 4),
    headings: uniqClaims(pages.flatMap((p) => p.headings.slice(0, 6).map((h) => ({ value: h, sourceUrl: p.url }))), 30),
    schemaTypes: types,
    brand: home?.brand ? { ...home.brand, sourceUrl: home.url } : undefined,
    keywordsFound: Array.from(new Set([...(svc.map((s) => s.value.toLowerCase())), ...(home?.headings.slice(0, 3).map((h) => h.toLowerCase()) || [])])).slice(0, 30),
  };
}
