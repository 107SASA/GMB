/**
 * On-page website SEO checks from the stored crawl (WebsiteIntelligence
 * pageSeo, v7+). RECOMMENDATIONS ONLY — nothing is changed on any website.
 * Pure. Name/address/phone consistency is already checked by fr4/website.ts
 * and is not repeated here.
 *
 * Every item names the page and the evidence it was found on. Only crawled
 * pages are judged ("not on the crawled pages", never "not on your site").
 * Location advice is one honest "areas we serve" section built from verified
 * service areas — never separate thin pages per town (doorway pages).
 */
import { stem, words } from './ids.ts';
import type { VerifiedService } from './trackedKeywords.ts';

export interface PageSeoInput {
  url: string;
  kind: string;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  canonical: string | null;
  noindex: boolean;
  internalLinks: string[];
  schemaTypes: string[];
  wordCount: number;
}

export interface WebsiteSeoItem {
  id: string;
  priority: 'high' | 'medium' | 'low';
  page: string | null;
  issue: string;
  evidence: string;
  recommendation: string;
  state: 'RECOMMENDATION';
}

export interface WebsiteSeo {
  status: 'measured' | 'not_measured';
  reason?: string;
  pagesChecked: number;
  items: WebsiteSeoItem[];
}

const LOCAL_TYPES = /LocalBusiness|Store|Restaurant|Dentist|MedicalBusiness|Physician|Clinic|AutoRepair|HomeAndConstructionBusiness|ProfessionalService|LegalService|FinancialService|HealthAndBeautyBusiness|EducationalOrganization|FoodEstablishment|LodgingBusiness|SportsActivityLocation/i;

const mentions = (text: string, term: string) => {
  const tw = words(term).map(stem).filter((w) => w.length >= 4 && !['service', 'services'].includes(w));
  const hay = new Set(words(text).map(stem));
  return tw.length > 0 && tw.every((w) => hay.has(w));
};

const pathOf = (url: string) => { try { return new URL(url).pathname.replace(/\/+$/, '') || '/'; } catch { return url; } };

export function analyzeWebsiteSeo(input: {
  pages: PageSeoInput[] | null | undefined;
  services: VerifiedService[];
  serviceAreas: string[];
  /** All crawled text claims (headings, services, areas, homepage text sample). */
  siteText: string;
  gbpServiceNames: string[] | null;
}): WebsiteSeo {
  const pages = input.pages || [];
  if (!pages.length) return { status: 'not_measured', reason: 'No per-page crawl data yet (it is collected at the next website read).', pagesChecked: 0, items: [] };
  const items: WebsiteSeoItem[] = [];
  const add = (i: Omit<WebsiteSeoItem, 'state'>) => items.push({ ...i, state: 'RECOMMENDATION' });

  // Titles, descriptions, H1, indexability, canonical — per page.
  const titleCount = new Map<string, number>();
  for (const p of pages) if (p.title) titleCount.set(p.title.toLowerCase(), (titleCount.get(p.title.toLowerCase()) || 0) + 1);
  for (const p of pages) {
    const path = pathOf(p.url);
    if (p.noindex) add({ id: `noindex:${path}`, priority: 'high', page: p.url, issue: 'Page is hidden from Google (noindex)', evidence: 'robots meta / X-Robots-Tag contains "noindex"', recommendation: 'Remove "noindex" if this page should appear in Google search.' });
    if (!p.title) add({ id: `title-missing:${path}`, priority: 'high', page: p.url, issue: 'No page title', evidence: 'No <title> tag found', recommendation: 'Add a title that names the main service and your city (about 50–60 characters).' });
    else if (p.title.length > 65) add({ id: `title-long:${path}`, priority: 'low', page: p.url, issue: `Title is ${p.title.length} characters`, evidence: `"${p.title}"`, recommendation: 'Shorten the title to about 60 characters so Google shows it in full.' });
    else if ((titleCount.get(p.title.toLowerCase()) || 0) > 1) add({ id: `title-dup:${path}`, priority: 'medium', page: p.url, issue: 'Same title as another page', evidence: `"${p.title}"`, recommendation: 'Give each page its own title describing what that page is about.' });
    if (!p.metaDescription) add({ id: `meta-missing:${path}`, priority: 'medium', page: p.url, issue: 'No meta description', evidence: 'No description meta tag found', recommendation: 'Add a one- or two-sentence description of the page (up to about 155 characters).' });
    else if (p.metaDescription.length > 170) add({ id: `meta-long:${path}`, priority: 'low', page: p.url, issue: `Meta description is ${p.metaDescription.length} characters`, evidence: p.metaDescription.slice(0, 80) + '…', recommendation: 'Shorten it to about 155 characters.' });
    if (p.h1.length === 0) add({ id: `h1-missing:${path}`, priority: 'medium', page: p.url, issue: 'No main heading (H1)', evidence: 'No <h1> found', recommendation: 'Add one H1 that says what the page offers.' });
    else if (p.h1.length > 1) add({ id: `h1-multi:${path}`, priority: 'low', page: p.url, issue: `${p.h1.length} main headings (H1)`, evidence: p.h1.slice(0, 3).map((h) => `"${h}"`).join(', '), recommendation: 'Keep a single H1 per page; use H2 for sections.' });
    if (p.canonical && pathOf(p.canonical) !== path && !p.canonical.startsWith(p.url.split('/').slice(0, 3).join('/'))) {
      add({ id: `canonical:${path}`, priority: 'high', page: p.url, issue: 'Canonical points to another site', evidence: `canonical = ${p.canonical}`, recommendation: 'Point the canonical tag at this page’s own address unless the copy elsewhere is intentional.' });
    }
    if (p.kind === 'service_detail' && p.wordCount < 150) add({ id: `thin:${path}`, priority: 'medium', page: p.url, issue: `Service page has about ${p.wordCount} words`, evidence: 'Word count of the crawled page text', recommendation: 'Explain the service in more detail: what it includes, who it is for, how to book.' });
  }

  // Structured data.
  const allTypes = pages.flatMap((p) => p.schemaTypes);
  if (!allTypes.some((t) => LOCAL_TYPES.test(t))) {
    add({ id: 'schema-localbusiness', priority: 'medium', page: pages[0].url, issue: 'No LocalBusiness structured data on the crawled pages', evidence: allTypes.length ? `Schema types found: ${Array.from(new Set(allTypes)).join(', ')}` : 'No JSON-LD types found', recommendation: 'Add LocalBusiness (or the specific type) schema with name, address, phone and opening hours matching your Google profile.' });
  }

  // Services: a page focusing on each verified service, linked from the homepage.
  const home = pages.find((p) => p.kind === 'home') || pages[0];
  for (const s of input.services.filter((x) => x.state !== 'SOURCE_CLAIM')) {
    const page = pages.find((p) => [p.title || '', ...p.h1].some((t) => mentions(t, s.name)));
    if (!page) {
      add({ id: `service-page:${s.id}`, priority: 'high', page: null, issue: `No crawled page focuses on "${s.name}"`, evidence: `"${s.name}" is ${s.state === 'VERIFIED' ? 'listed on your Google profile' : 'one of your services'}, but no crawled page title or H1 names it`, recommendation: `Add a page (or a clear section) about ${s.name}: what it is, who it is for, price or how to enquire — and link to it from the homepage.` });
    } else if (page !== home && !home.internalLinks.includes(pathOf(page.url))) {
      add({ id: `service-link:${s.id}`, priority: 'medium', page: page.url, issue: `The ${s.name} page is not linked from the homepage`, evidence: `Homepage links checked: ${home.internalLinks.length}`, recommendation: `Link to the ${s.name} page from the homepage (e.g. in the services section).` });
    }
  }
  // Website services not on the Google profile (consistency).
  if (input.gbpServiceNames) {
    for (const s of input.services.filter((x) => x.state === 'SOURCE_CLAIM').slice(0, 3)) {
      if (!input.gbpServiceNames.some((g) => mentions(g, s.name) || mentions(s.name, g))) {
        add({ id: `gbp-missing:${s.id}`, priority: 'medium', page: null, issue: `"${s.name}" is on the website but not in your Google services`, evidence: 'Website service claim vs Google Business Profile services list', recommendation: `If you offer ${s.name}, add it to the services on your Google Business Profile.` });
      }
    }
  }

  // Areas: one honest "areas we serve" section — never a page per town.
  const missingAreas = input.serviceAreas.filter((a) => !mentions(input.siteText, a));
  if (missingAreas.length) {
    add({ id: 'areas-section', priority: 'low', page: home.url, issue: `Your Google service areas are not mentioned on the crawled pages: ${missingAreas.slice(0, 6).join(', ')}`, evidence: 'Google Business Profile service areas vs crawled page text', recommendation: 'Add one "Areas we serve" section listing the areas you really serve. Do not create separate thin pages per town.' });
  }

  const order = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => order[a.priority] - order[b.priority]);
  return { status: 'measured', pagesChecked: pages.length, items: items.slice(0, 20) };
}

export function websiteSeoLines(w: WebsiteSeo | null | undefined): string[] {
  if (!w || w.status !== 'measured') return [];
  return w.items.filter((i) => i.priority !== 'low').slice(0, 6).map((i) => `Website: ${i.issue}${i.page ? ` (${i.page})` : ''}`);
}
