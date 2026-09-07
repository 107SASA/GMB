import { resolveSearchCategory, normalizeBusinessName } from './seoAnalyzer';

/**
 * Keyword set for the free report's "Keyword Search Volume Analysis" table.
 *
 * The signature move (matching the reference report) is hyper-local phrases:
 * "<category> <neighbourhood>" for each neighbourhood around the business —
 * "IT Training Institute Bidhannagar", "IT Training Institute Rajarhat", …
 * plus the city-level workhorse phrases and a couple of adjacent categories.
 *
 * Neighbourhoods come from src/services/audit/localities.ts (reverse
 * geocoding). With none available we fall back to city-level phrases only.
 */

// Broader category families → a couple of adjacent search terms people also
// use. Keeps the table from being 14 rows of the same phrase with a place
// swapped in. Deliberately small and hand-picked — not an AI call.
const ADJACENT_CATEGORIES: Array<{ match: RegExp; adjacent: string[] }> = [
  { match: /\b(it|software|computer|coding|programming)\b/i, adjacent: ['computer training', 'software training institute'] },
  { match: /\b(gym|fitness|crossfit)\b/i, adjacent: ['fitness center', 'personal training'] },
  { match: /\b(salon|spa|beauty|parlour|parlor)\b/i, adjacent: ['beauty parlour', 'hair salon'] },
  { match: /\b(dental|dentist)\b/i, adjacent: ['dental clinic', 'teeth whitening'] },
  { match: /\b(clinic|hospital|doctor|medical)\b/i, adjacent: ['medical clinic', 'health checkup'] },
  { match: /\b(restaurant|cafe|café|bakery|food)\b/i, adjacent: ['best restaurant', 'family restaurant'] },
  { match: /\b(school|academy|coaching|tuition|institute|training)\b/i, adjacent: ['coaching classes', 'training institute'] },
  { match: /\b(real estate|property|realtor)\b/i, adjacent: ['property dealer', 'flats for sale'] },
  { match: /\b(law|legal|advocate|lawyer)\b/i, adjacent: ['law firm', 'legal consultant'] },
];

function titleCasePhrase(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export interface FreeReportKeywords {
  /** The full ordered list to rank + volume-check (deduped, ~10-16 rows). */
  keywords: string[];
  /** The single phrase the map/grid is built around. */
  primaryKeyword: string;
  /** Neighbourhood names actually used (for "Areas checked: …"). */
  areasUsed: string[];
}

export function buildFreeReportKeywords(
  business: any,
  neighbourhoods: string[] = [],
): FreeReportKeywords {
  const category = resolveSearchCategory(
    business.category || business.userDefinedCategory,
    business.name || business.businessName,
    [business.city, business.area, business.state],
  );
  const cat = titleCasePhrase(category);
  const catLower = cat.toLowerCase();
  const city = titleCasePhrase(business.city || '');
  const area = titleCasePhrase(business.area || '');
  const brand = normalizeBusinessName(business.name || business.businessName || '')
    .split(' ')
    .slice(0, 3)
    .join(' ')
    .trim();

  const areas = neighbourhoods
    .map(titleCasePhrase)
    .filter((a) => a && a.toLowerCase() !== city.toLowerCase())
    .slice(0, 7);

  const out: string[] = [];
  const push = (k?: string) => {
    const v = titleCasePhrase(k || '');
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  };

  // 1. hyper-local: "<category> <neighbourhood>"
  for (const a of areas) push(`${cat} ${a}`);

  // 2. city workhorses
  if (city) {
    push(`${catLower} ${city}`);
    push(`Best ${catLower} ${city}`);
  } else {
    push(catLower);
    push(`Best ${catLower}`);
  }

  // 3. brand + city (people search the business by name too)
  if (brand && city) push(`${titleCasePhrase(business.name || '').split(',')[0].trim()} ${city}`);

  // 4. "<category-ish> <first area>" variants
  if (areas[0]) {
    push(`${catLower.replace(/institute|center|centre/i, 'courses').trim()} ${areas[0]}`);
    push(`${catLower} near ${areas[0]}`);
  }

  // 5. adjacent categories at city level
  const adj = ADJACENT_CATEGORIES.find((a) => a.match.test(catLower))?.adjacent ?? [];
  for (const a of adj) push(city ? `${a} ${city}` : a);

  const keywords = out.slice(0, 16);
  return {
    keywords: keywords.length ? keywords : [city ? `${catLower} ${city}` : catLower],
    primaryKeyword: keywords[0] || (city ? `${catLower} ${city}` : catLower),
    areasUsed: areas,
  };
}
