/**
 * Onboarding prefill from stored intelligence (pure — runs under `node --test`).
 *
 * Suggestions are never written into the business automatically: each one
 * carries its source, and the owner accepts or edits it in the intake form.
 * Only empty fields get a suggestion, so an owner's own answer is never
 * replaced.
 */

export type PrefillSource = 'website' | 'google_listing' | 'measured_report';

export interface PrefillSuggestion {
  value: string;
  source: PrefillSource;
  /** Page / listing the value came from. */
  sourceUrl?: string;
  label: string;
}

export interface PrefillInput {
  business: {
    description?: string;
    services?: string;
    offers?: string;
    keywords?: string[];
    city?: string;
    area?: string;
    category?: string;
    userDefinedCategory?: string;
    intake?: { uniqueSellingPoints?: string };
  };
  /** Stored WebsiteIntelligence doc (lean) or null. */
  website?: {
    origin?: string;
    status?: string;
    description?: { value: string; sourceUrl?: string } | null;
    services?: Array<{ value: string; sourceUrl?: string }>;
    credentials?: Array<{ value: string; sourceUrl?: string }>;
    differentiators?: Array<{ value: string; sourceUrl?: string }>;
    offers?: Array<{ value: string; sourceUrl?: string }>;
    serviceAreas?: Array<{ value: string; sourceUrl?: string }>;
  } | null;
  /** Measured, non-brand keyword rows from the latest completed audit. */
  measuredKeywords?: Array<{ keyword: string; source?: string }>;
  /** Primary category shown on the public Google listing. */
  listingCategory?: string | null;
}

const empty = (v?: string | null) => !v || !String(v).trim() || v === 'Local Business';

export function buildIntakePrefill(input: PrefillInput): Partial<Record<'category' | 'description' | 'services' | 'keywords' | 'uniqueSellingPoints' | 'offers', PrefillSuggestion>> {
  const b = input.business;
  const w = input.website && input.website.status !== 'failed' ? input.website : null;
  const out: ReturnType<typeof buildIntakePrefill> = {};
  const siteLabel = 'From your website — review';

  const cat = [b.userDefinedCategory, b.category].find((c) => !empty(c));
  if (!cat && input.listingCategory && !/^services?$/i.test(input.listingCategory)) {
    out.category = { value: input.listingCategory, source: 'google_listing', label: 'From your Google listing — review' };
  }

  if (empty(b.description) && w?.description?.value) {
    out.description = { value: w.description.value.slice(0, 600), source: 'website', sourceUrl: w.description.sourceUrl, label: siteLabel };
  }

  if (empty(b.services) && w?.services?.length) {
    out.services = {
      value: w.services.slice(0, 10).map((s) => s.value).join(', '),
      source: 'website',
      sourceUrl: w.services[0].sourceUrl,
      label: siteLabel,
    };
  }

  const kw = (b.keywords || []).filter((k) => /[a-z]/i.test(k));
  const measured = (input.measuredKeywords || []).filter((k) => k.source !== 'brand').map((k) => k.keyword);
  if (kw.length === 0 && measured.length) {
    out.keywords = { value: Array.from(new Set(measured)).slice(0, 8).join(', '), source: 'measured_report', label: 'Searches measured in your report — review' };
  }

  const usp = [...(w?.credentials || []), ...(w?.differentiators || [])];
  if (empty(b.intake?.uniqueSellingPoints) && usp.length) {
    out.uniqueSellingPoints = { value: usp.slice(0, 3).map((u) => u.value).join('; '), source: 'website', sourceUrl: usp[0].sourceUrl, label: siteLabel };
  }
  if (empty(b.offers) && w?.offers?.length) {
    out.offers = { value: w.offers.slice(0, 2).map((o) => o.value).join('; '), source: 'website', sourceUrl: w.offers[0].sourceUrl, label: siteLabel };
  }
  return out;
}
