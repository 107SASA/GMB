/**
 * Deterministic competitor insights (pure — runs under `node --test`).
 *
 * Every insight is three labelled parts:
 *   fact           — counted from real provider data (Maps results, websites read)
 *   meaning        — a cautious inference; never a claim that X causes rank
 *   recommendation — an action, only "if true for your business" where the
 *                    fact is about competitors rather than the target
 * Numbers are computed here, so nothing an AI writes is needed for them.
 */

export interface InsightCompetitor {
  name: string;
  source?: 'dataforseo' | 'google_places';
  rating?: number | null;
  reviewCount?: number | null;
  top3Count?: number;
  hasWebsite?: boolean;
  hasBookingLink?: boolean;
  additionalCategories?: string[] | null;
  /** Services the competitor's own website states (SOURCE_CLAIM). */
  websiteServices?: string[];
}

export interface InsightTarget {
  name: string;
  rating: number | null;
  reviewCount: number | null;
  /** Public listing seen in results (so hasWebsite/hasBookingLink are Google's). */
  listingObserved: boolean;
  hasWebsite: boolean | null;
  hasBookingLink: boolean | null;
  additionalCategories: string[] | null;
  top3Searches: number;
  searches: number;
  /** Services the target's website or owner states. */
  services: string[];
  /** Booking URL the target's own website shows, if any. */
  websiteBookingUrl?: string | null;
}

export interface CompetitorInsight {
  topic: 'reviews' | 'booking' | 'categories' | 'services' | 'top3' | 'website';
  fact: string;
  meaning: string;
  recommendation: string;
  /** What the fact is counted from. */
  basis: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const words = (s: string) =>
  String(s || '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const STOP = new Set(['services', 'service', 'solutions', 'company', 'best', 'with', 'your', 'from', 'and', 'the', 'for', 'our', 'all', 'custom', 'professional', 'local']);

/** Two service names describe the same service when they share a meaningful word. */
export function sameService(a: string, b: string): boolean {
  const wa = new Set(words(a));
  return words(b).some((w) => wa.has(w));
}

/** Services stated on >= 2 competitor websites that the target does not state. */
export function commonCompetitorServices(competitors: InsightCompetitor[], targetServices: string[]): Array<{ service: string; count: number; of: number }> {
  const read = competitors.filter((c) => Array.isArray(c.websiteServices) && c.websiteServices.length > 0);
  if (read.length < 2) return [];
  const groups: Array<{ service: string; owners: Set<string> }> = [];
  for (const c of read) {
    for (const s of c.websiteServices!) {
      const g = groups.find((x) => sameService(x.service, s));
      if (g) g.owners.add(c.name);
      else groups.push({ service: s, owners: new Set([c.name]) });
    }
  }
  return groups
    .filter((g) => g.owners.size >= 2 && !targetServices.some((t) => sameService(t, g.service)))
    .sort((a, b) => b.owners.size - a.owners.size)
    .slice(0, 3)
    .map((g) => ({ service: g.service, count: g.owners.size, of: read.length }));
}

export function buildCompetitorInsights(all: InsightCompetitor[], t: InsightTarget): CompetitorInsight[] {
  // Only businesses read from real Maps results carry listing fields.
  const set = all.filter((c) => c.source !== 'google_places').slice(0, 10);
  if (!set.length) return [];
  const n = set.length;
  const out: CompetitorInsight[] = [];
  const basis = `the ${n} businesses shown above ${t.name} most often in our Google Maps searches`;

  // Reviews — lifetime totals from the same results.
  const counts = set.map((c) => c.reviewCount).filter((v): v is number => typeof v === 'number');
  if (counts.length >= 2 && t.reviewCount != null) {
    const med = Math.round(median(counts));
    const more = counts.filter((v) => v > t.reviewCount!).length;
    out.push({
      topic: 'reviews',
      fact: `${more} of the ${counts.length} businesses above you that show a review count have more Google reviews than your ${t.reviewCount}; their median is ${med}.`,
      meaning: t.reviewCount < med
        ? 'Searchers comparing listings side by side see more customer feedback on theirs.'
        : 'Your review total is not the gap — other factors separate you from them.',
      recommendation: t.reviewCount < med
        ? 'Ask every recent customer for a Google review and reply to each one (GrowwMatics review requests and replies).'
        : 'Keep reviews coming steadily and reply to every one.',
      basis,
    });
  }

  // Booking link on the public listing.
  const booking = set.filter((c) => typeof c.hasBookingLink === 'boolean');
  const withBooking = booking.filter((c) => c.hasBookingLink).length;
  if (booking.length && withBooking > 0 && t.listingObserved && t.hasBookingLink === false) {
    out.push({
      topic: 'booking',
      fact: `${withBooking} of ${booking.length} businesses shown above you show a booking link on their Google listing; yours did not show one in the results we read.`,
      meaning: 'Those listings let a searcher book straight from Google Maps.',
      recommendation: t.websiteBookingUrl
        ? `Your website has a booking page (${t.websiteBookingUrl}) — add it as the appointment link in Google Business Profile.`
        : 'If you take bookings or appointments, add the booking link in Google Business Profile.',
      basis,
    });
  }

  // Additional categories (public listing).
  const cats = set.filter((c) => Array.isArray(c.additionalCategories));
  const withCats = cats.filter((c) => c.additionalCategories!.length > 0).length;
  if (cats.length && withCats > 0 && !(t.additionalCategories && t.additionalCategories.length)) {
    out.push({
      topic: 'categories',
      fact: `${withCats} of ${cats.length} businesses shown above you list additional Google categories; we could not see any on yours.`,
      meaning: 'Additional categories let a listing appear for more of the services it genuinely offers.',
      recommendation: 'Check your Google Business Profile categories and add any that truly describe your services (you change categories in Google — GrowwMatics cannot).',
      basis,
    });
  }

  // Top-3 presence.
  const inTop3 = set.filter((c) => (c.top3Count ?? 0) > 0).length;
  if (t.searches > 0 && inTop3 > 0 && t.top3Searches === 0) {
    out.push({
      topic: 'top3',
      fact: `${inTop3} of ${n} businesses shown above you reached the top 3 in at least one search; you were in the top 3 in none of ${t.searches}.`,
      meaning: 'The top 3 is the part of Google Maps most searchers look at first.',
      recommendation: 'Work through the listing fixes in this report first, then re-measure the same searches.',
      basis,
    });
  }

  // Services their websites state that yours doesn't (SOURCE_CLAIM on both sides).
  for (const s of commonCompetitorServices(set, t.services).slice(0, 2)) {
    out.push({
      topic: 'services',
      fact: `${s.count} of the ${s.of} competitor websites we read describe "${s.service}"; your website and details did not mention it.`,
      meaning: 'Competitors are describing this service to searchers; if you offer it, customers cannot tell from your pages.',
      recommendation: `Only if you genuinely offer ${s.service}: describe it on your website and in your Google Business Profile services.`,
      basis: `the websites of the top competitors (${s.of} read, up to 2 pages each)`,
    });
  }

  // Website on listing.
  const site = set.filter((c) => typeof c.hasWebsite === 'boolean');
  const withSite = site.filter((c) => c.hasWebsite).length;
  if (site.length && withSite > 0 && t.listingObserved && t.hasWebsite === false) {
    out.push({
      topic: 'website',
      fact: `${withSite} of ${site.length} businesses shown above you have a website on their Google listing; yours did not show one.`,
      meaning: 'A website link gives searchers somewhere to check your services before calling.',
      recommendation: 'Add your website to Google Business Profile (GrowwMatics can update it once Google is connected).',
      basis,
    });
  }
  return out;
}
