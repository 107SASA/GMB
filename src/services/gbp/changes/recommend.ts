/**
 * Category and attribute recommendations from already-verified inputs.
 * A category resource name is used only when the caller supplies a catalog
 * match. Display names are never turned into ids here.
 */

const GENERIC = new Set(['local business', 'business', 'establishment', 'point of interest', 'service', 'services', 'general', 'company']);

export interface CatalogCategory { name: string; displayName: string }

export interface CategoryRecommendation {
  role: 'primary' | 'additional';
  displayName: string;
  /** Google resource name. Null when the catalog did not resolve it. */
  categoryName: string | null;
  reason: string;
  competitors: string[];
  services: string[];
  confidence: 'high' | 'medium';
  risk: 'high' | 'low';
  autoApply: false;
  executable: boolean;
  /** Primary only: the competitors ranking above this business that back it. */
  outrankers?: { count: number; total: number; keywords: string[] };
}

/** One local-pack competitor as recommendCategories reads it. */
export interface CategoryCompetitor {
  name: string;
  placeId?: string | null;
  primaryCategory?: string | null;
  additionalCategories?: string[];
  /** The keyword this pack result was measured for. Without it the row never counts as outranking. */
  keyword?: string;
  /** 1-based pack position of the competitor. */
  position?: number | null;
  /** 1-based position of the business itself on that keyword; null = not in the measured results. */
  ownPosition?: number | null;
}

export interface OutrankerTally {
  label: string;
  count: number;
  competitors: string[];
  keywords: string[];
}

/**
 * Main categories of the competitors that rank ABOVE this business, counted
 * once per competitor (one ahead on 3 keywords is still 1 vote). `total` is
 * how many of those outranking competitors have a known main category.
 */
export function outrankerPrimaryTally(competitors: CategoryCompetitor[], businessName: string): { total: number; tally: OutrankerTally[] } {
  const own = businessName.trim().toLowerCase();
  const byCompetitor = new Map<string, { label: string; name: string; keywords: Set<string> }>();
  for (const c of competitors) {
    if (!c.keyword || typeof c.position !== 'number' || !c.primaryCategory?.trim()) continue;
    if (c.name.trim().toLowerCase() === own) continue;
    const ahead = c.ownPosition == null || c.position < c.ownPosition;
    if (!ahead) continue;
    const key = c.placeId || c.name.trim().toLowerCase();
    const row = byCompetitor.get(key) || { label: c.primaryCategory.trim(), name: c.name, keywords: new Set<string>() };
    row.keywords.add(c.keyword);
    byCompetitor.set(key, row);
  }
  const tally = new Map<string, OutrankerTally>();
  for (const row of byCompetitor.values()) {
    const k = row.label.toLowerCase();
    const t = tally.get(k) || { label: row.label, count: 0, competitors: [], keywords: [] };
    t.count += 1;
    t.competitors.push(row.name);
    for (const kw of row.keywords) if (!t.keywords.includes(kw)) t.keywords.push(kw);
    tally.set(k, t);
  }
  return { total: byCompetitor.size, tally: [...tally.values()].sort((a, b) => b.count - a.count) };
}

/** A competitor main category needs this many outranking backers… */
const PRIMARY_MIN_BACKERS = 3;
/** …and at least this share of the outranking competitors. */
const PRIMARY_MIN_SHARE = 0.5;

/** Same trade, different wording — "Dentist" / "Dental clinic", "Beauty salon" / "Beauty parlour". */
function relatedCategory(a: string, b: string): boolean {
  const stems = (s: string) => new Set(tokens(s).map((t) => t.slice(0, 4)));
  const sa = stems(a);
  return [...stems(b)].some((t) => sa.has(t));
}

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 4);
}

function overlaps(category: string, services: string[]): string[] {
  const c = new Set(tokens(category));
  return services.filter((s) => tokens(s).some((t) => c.has(t)));
}

export function recommendCategories(input: {
  businessName: string;
  currentPrimary: { name: string; displayName: string } | null;
  currentAdditional: Array<{ name: string; displayName: string }>;
  competitors: CategoryCompetitor[];
  services: string[];
  catalog: CatalogCategory[];
}): { primary: CategoryRecommendation | null; additional: CategoryRecommendation[] } {
  const own = input.businessName.trim().toLowerCase();
  const have = new Set(
    [input.currentPrimary?.displayName, ...input.currentAdditional.map((c) => c.displayName)]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase()),
  );
  const usage = new Map<string, { count: number; competitors: string[] }>();
  for (const c of input.competitors) {
    if (c.name.trim().toLowerCase() === own) continue;
    const names = [c.primaryCategory, ...(c.additionalCategories || [])].filter((n): n is string => !!n);
    for (const name of names) {
      const key = name.trim();
      if (!key) continue;
      const row = usage.get(key.toLowerCase()) || { count: 0, competitors: [] };
      row.count += 1;
      if (!row.competitors.includes(c.name)) row.competitors.push(c.name);
      usage.set(key.toLowerCase(), row);
    }
  }
  const catalogByName = new Map(input.catalog.map((c) => [c.displayName.toLowerCase(), c]));
  const labelOf = new Map<string, string>();
  for (const c of input.competitors) {
    for (const name of [c.primaryCategory, ...(c.additionalCategories || [])]) {
      if (name) labelOf.set(name.toLowerCase(), name.trim());
    }
  }
  const additional: CategoryRecommendation[] = [];
  let primary: CategoryRecommendation | null = null;
  for (const [key, row] of usage) {
    const label = labelOf.get(key) || key;
    if (have.has(label.toLowerCase())) continue;
    const matchedServices = overlaps(label, input.services);
    if (row.count < 2 && matchedServices.length === 0) continue;
    const resolved = catalogByName.get(label.toLowerCase()) || null;
    const rec: CategoryRecommendation = {
      role: 'additional',
      displayName: resolved?.displayName || label,
      categoryName: resolved?.name || null,
      reason: row.count >= 2
        ? `Used by ${row.count} competitors in the measured local pack.`
        : 'Matches a verified service. Competitor usage alone was not enough.',
      competitors: row.competitors.slice(0, 5),
      services: matchedServices,
      confidence: resolved && (row.count >= 2 || matchedServices.length > 0) ? 'high' : 'medium',
      risk: 'low',
      autoApply: false,
      executable: !!resolved?.name,
    };
    additional.push(rec);
  }
  for (const entry of input.catalog) {
    const key = entry.displayName.toLowerCase();
    if (have.has(key) || additional.some((row) => row.displayName.toLowerCase() === key)) continue;
    const matchedServices = overlaps(entry.displayName, input.services);
    if (matchedServices.length === 0 || !entry.name) continue;
    additional.push({
      role: 'additional',
      displayName: entry.displayName,
      categoryName: entry.name,
      reason: 'Matches a verified service. Competitor usage was not required once Google resolved the category.',
      competitors: [],
      services: matchedServices,
      confidence: 'high',
      risk: 'low',
      autoApply: false,
      executable: true,
    });
  }
  const currentLabel = input.currentPrimary?.displayName || '';
  const currentIsGeneric = GENERIC.has(currentLabel.toLowerCase());

  // 1) What the businesses that out-rank this one use as their main category.
  const { total, tally } = outrankerPrimaryTally(input.competitors, input.businessName);
  const top = tally[0];
  if (
    top &&
    top.count >= PRIMARY_MIN_BACKERS &&
    top.count / total >= PRIMARY_MIN_SHARE &&
    top.label.toLowerCase() !== currentLabel.toLowerCase()
  ) {
    const isOwnSecondary = input.currentAdditional.some((c) => c.displayName.toLowerCase() === top.label.toLowerCase());
    const matchedServices = overlaps(top.label, input.services);
    // Never a different trade: it has to be one of their own categories, a
    // service they offer, a variant of their current category, or replace a generic one.
    const related = isOwnSecondary || matchedServices.length > 0 || currentIsGeneric || (!!currentLabel && relatedCategory(top.label, currentLabel));
    if (related) {
      const resolved = catalogByName.get(top.label.toLowerCase())
        || input.currentAdditional.find((c) => c.displayName.toLowerCase() === top.label.toLowerCase())
        || null;
      const kw = top.keywords.slice(0, 3).map((k) => `“${k}”`).join(', ');
      primary = {
        role: 'primary',
        displayName: resolved?.displayName || top.label,
        categoryName: resolved?.name || null,
        reason:
          `${top.count} of the ${total} businesses ranking above you${kw ? ` for ${kw}` : ''} use “${top.label}” as their main category` +
          (currentLabel ? `; yours is “${currentLabel}”.` : '.') +
          (isOwnSecondary ? ' You already have it as a secondary category.' : ''),
        competitors: top.competitors.slice(0, 5),
        services: matchedServices,
        confidence: isOwnSecondary || matchedServices.length > 0 ? 'high' : 'medium',
        risk: 'high',
        autoApply: false,
        executable: !!resolved?.name,
        outrankers: { count: top.count, total, keywords: top.keywords },
      };
    }
  }

  // 2) Fallback: a generic main category ("Local business") swapped for a service-backed one.
  if (!primary && currentIsGeneric) {
    const better = additional.find((r) => r.executable && r.services.length > 0);
    if (better) {
      primary = { ...better, role: 'primary', risk: 'high', autoApply: false, reason: `The current primary category “${currentLabel}” is generic. ${better.reason}` };
    }
  }
  return { primary, additional: additional.filter((r) => r.displayName.toLowerCase() !== primary?.displayName.toLowerCase()).slice(0, 5) };
}

export interface AttributeSuggestion {
  name: string;
  displayName: string;
  valueType: string;
  executable: false;
  reason: string;
}

/** Unset attributes from an authoritative catalog. No value is invented. */
export function suggestUnsetAttributes(
  catalog: Array<{ name: string; displayName: string; valueType: string }> | null,
  currentNames: string[],
): { available: boolean; reason: string; suggestions: AttributeSuggestion[] } {
  if (!catalog) {
    return { available: false, reason: 'The Google attribute catalog for this category was not available. No attributes were guessed.', suggestions: [] };
  }
  const have = new Set(currentNames);
  const suggestions = catalog
    .filter((a) => a.name && !have.has(a.name))
    .slice(0, 20)
    .map((a) => ({
      name: a.name,
      displayName: a.displayName || a.name,
      valueType: a.valueType,
      executable: false as const,
      reason: 'Applicable to this category and not currently set. A value has to be chosen before it can be written.',
    }));
  return { available: true, reason: 'Catalog attributes that are not set. Nothing is written until a value is approved.', suggestions };
}

export interface ServiceProposal {
  name: string;
  description: string;
  price: null;
  evidence: string[];
  keywordRationale: string;
  /** 'google' = one of Google's predefined services for the listing's categories; 'custom' = the owner's own wording. */
  kind: 'google' | 'custom';
  /** Google's id for a predefined service — written as a structured service. */
  serviceTypeId?: string;
  /** The listing category the service belongs to (predefined services only). */
  categoryName?: string;
  /** Ticked for the owner by default: backed by what they or their website say they offer. */
  preselected: boolean;
}

const SERVICE_STOP = new Set(['and', 'the', 'for', 'with', 'of', 'in', 'service', 'services', 'center', 'centre', 'shop', 'store', 'best', 'all', 'our']);

/** Words of a service name, lightly stemmed ("repairs" → "repair", "colouring" → "colour"). */
function serviceWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !SERVICE_STOP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(ing|s)$/, '') : w));
}

/**
 * Same service, different wording: every word of the shorter name appears in
 * the longer one ("Teeth whitening" ≈ "Teeth Whitening Treatment",
 * "AC repair" ≈ "AC Repair & Service"). One shared word is not enough —
 * "Hair cut" is not "Hair colouring".
 */
export function sameService(a: string, b: string): boolean {
  const wa = serviceWords(a);
  const wb = serviceWords(b);
  if (!wa.length || !wb.length) return false;
  const [short, long] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
  return short.every((w) => long.has(w));
}

/** How many of Google's other predefined services are offered (unticked) for the owner to tap. */
const MORE_GOOGLE_SERVICES = 15;

/**
 * Services to add — automated: the owner only reviews and taps once.
 *  1. Google's predefined services that match what the owner / their website
 *     say they offer → ticked (written as structured services).
 *  2. Their other services → ticked, written in their own words.
 *  3. The rest of Google's list for their categories → shown unticked.
 * Anything already on the profile (by Google id or by name) is skipped.
 */
export function proposeServices(input: {
  existing: string[];
  /** Ids of Google predefined services already on the profile. */
  existingTypeIds?: string[];
  verified: string[];
  /** Google's predefined services for the listing's categories (null/empty when unavailable). */
  googleServices?: Array<{ serviceTypeId: string; displayName: string; categoryName: string }> | null;
  category: string;
  city: string;
  canModify: boolean | null;
}): { blocked: boolean; reason: string | null; items: ServiceProposal[] } {
  if (input.canModify === false) {
    return { blocked: true, reason: 'Google says this service list cannot be modified.', items: [] };
  }
  const haveIds = new Set(input.existingTypeIds || []);
  const haveNames = input.existing.map((s) => s.trim()).filter(Boolean);
  const onProfile = (name: string) => haveNames.some((h) => h.toLowerCase() === name.toLowerCase() || sameService(h, name));

  const google = [...new Map((input.googleServices || []).map((g) => [g.serviceTypeId, g])).values()]
    .filter((g) => !haveIds.has(g.serviceTypeId) && !onProfile(g.displayName));
  const verified = [...new Map(input.verified.map((s) => s.trim()).filter(Boolean).map((s) => [s.toLowerCase(), s])).values()]
    .filter((s) => !onProfile(s));

  const items: ServiceProposal[] = [];
  const usedGoogle = new Set<string>();
  for (const name of verified) {
    const match = google.find((g) => !usedGoogle.has(g.serviceTypeId) && sameService(g.displayName, name));
    if (match) {
      usedGoogle.add(match.serviceTypeId);
      items.push({
        name: match.displayName,
        description: '',
        price: null,
        evidence: ['verified_service', 'google_service_type'],
        keywordRationale: `Google's own service for your category, matching “${name}” that you offer.`,
        kind: 'google',
        serviceTypeId: match.serviceTypeId,
        categoryName: match.categoryName,
        preselected: true,
      });
    } else {
      items.push({
        name,
        description: `${name} from ${input.category || 'this business'}${input.city ? ` in ${input.city}` : ''}.`.slice(0, 300),
        price: null,
        evidence: ['verified_service'],
        keywordRationale: 'The name is a verified service. No extra keyword was added.',
        kind: 'custom',
        preselected: true,
      });
    }
  }
  const picked = items.slice(0, 20);
  for (const g of google) {
    if (usedGoogle.has(g.serviceTypeId)) continue;
    if (picked.filter((i) => !i.preselected).length >= MORE_GOOGLE_SERVICES) break;
    picked.push({
      name: g.displayName,
      description: '',
      price: null,
      evidence: ['google_service_type'],
      keywordRationale: 'Listed by Google for your category. Tick it only if you offer it.',
      kind: 'google',
      serviceTypeId: g.serviceTypeId,
      categoryName: g.categoryName,
      preselected: false,
    });
  }
  return { blocked: false, reason: null, items: picked };
}
