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
  competitors: Array<{ name: string; primaryCategory?: string | null; additionalCategories?: string[] }>;
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
  if (GENERIC.has(currentLabel.toLowerCase())) {
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
}

export function proposeServices(input: {
  existing: string[];
  verified: string[];
  category: string;
  city: string;
  canModify: boolean | null;
}): { blocked: boolean; reason: string | null; items: ServiceProposal[] } {
  if (input.canModify === false) {
    return { blocked: true, reason: 'Google says this service list cannot be modified.', items: [] };
  }
  const have = new Set(input.existing.map((s) => s.trim().toLowerCase()));
  const items = input.verified
    .map((s) => s.trim())
    .filter((s) => s && !have.has(s.toLowerCase()))
    .slice(0, 20)
    .map((name) => ({
      name,
      description: `${name} from ${input.category || 'this business'}${input.city ? ` in ${input.city}` : ''}.`.slice(0, 300),
      price: null as null,
      evidence: ['verified_service'],
      keywordRationale: 'The name is a verified service. No extra keyword was added.',
    }));
  return { blocked: false, reason: null, items };
}
