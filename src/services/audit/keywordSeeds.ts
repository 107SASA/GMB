import { resolveSearchCategory } from './seoAnalyzer';

/**
 * Keyword set for the free report's "Keyword Search Volume Analysis" table.
 *
 * The signature move (matching the reference report) is hyper-local phrases:
 * "<category> <neighbourhood>" for each neighbourhood around the business —
 * "IT Training Institute Bidhannagar", "IT Training Institute Rajarhat", …
 * plus the city-level workhorse phrases, the brand + city, and a couple of
 * adjacent categories.
 *
 * Neighbourhoods come from src/services/audit/localities.ts (reverse
 * geocoding). With none available we fall back to city-level phrases only.
 */

const SELF_PRAISE = /\b(top|best|no\.?\s*1|number\s*1|#1|premier|leading|famous|finest|trusted|official|authoriz(?:ed|es)?|authoris(?:ed|es)?)\b/gi;

// Broader category families → a couple of adjacent search terms people also
// use. Keeps the table from being 14 rows of the same phrase with a place
// swapped in. Deliberately small and hand-picked — not an AI call.
const ADJACENT_CATEGORIES: Array<{ match: RegExp; adjacent: string[] }> = [
  { match: /\b(it|software|computer|coding|programming|tech)\b/i, adjacent: ['Computer training', 'Software training institute'] },
  { match: /\b(gym|fitness|crossfit)\b/i, adjacent: ['Fitness center', 'Personal training'] },
  { match: /\b(salon|spa|beauty|parlou?r)\b/i, adjacent: ['Beauty parlour', 'Hair salon'] },
  { match: /\b(dental|dentist)\b/i, adjacent: ['Dental clinic', 'Teeth whitening'] },
  { match: /\b(clinic|hospital|doctor|medical|diagnostic)\b/i, adjacent: ['Medical clinic', 'Health checkup'] },
  { match: /\b(restaurant|cafe|café|bakery|food|kitchen|catering)\b/i, adjacent: ['Best restaurant', 'Family restaurant'] },
  { match: /\b(school|academy|coaching|tuition|institute|training|classes|college)\b/i, adjacent: ['Coaching classes', 'Training institute'] },
  { match: /\b(real estate|property|realtor|builder|developer)\b/i, adjacent: ['Property dealer', 'Flats for sale'] },
  { match: /\b(law|legal|advocate|lawyer|associates)\b/i, adjacent: ['Law firm', 'Legal consultant'] },
  { match: /\b(interior|architect|furniture)\b/i, adjacent: ['Interior designer', 'Modular kitchen'] },
];

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** The distinctive brand token(s) — the part before a " - " / " | " / "," /
 *  " – ", first 3 words, self-praise stripped. "Desun Academy - Top IT
 *  Training Institute in Kolkata" → "Desun Academy". */
const BRAND_STOPWORDS = new Set(['ka', 'ki', 'ke', 'and', 'the', 'of', 'de', 'da', 'by', '&']);
function brandToken(name: string): string {
  let b = (name || '').split(/\s[-–|]\s|,/)[0];
  b = tidy(b.replace(SELF_PRAISE, ' '));
  const words = b.split(' ');
  const out: string[] = [];
  for (const w of words) {
    if (out.length >= 3) break;
    if (BRAND_STOPWORDS.has(w.toLowerCase())) break;
    out.push(w);
  }
  return tidy(out.join(' '));
}

/** A shorter noun form of the category for the "Best <x> <city>" /
 *  "<x> near <area>" phrasings ("IT Training Institute" → "IT training"). */
function shortCategory(cat: string): string {
  const words = tidy(cat).split(' ');
  if (words.length <= 2) return tidy(cat);
  // drop a trailing structural noun (institute/center/centre/school/academy)
  const tail = words[words.length - 1].toLowerCase();
  if (['institute', 'center', 'centre', 'school', 'academy', 'classes', 'training'].includes(tail)) {
    return tidy(words.slice(0, -1).join(' '));
  }
  return tidy(words.slice(0, 2).join(' '));
}

export interface FreeReportKeywords {
  keywords: string[];
  primaryKeyword: string;
  areasUsed: string[];
}

export function buildFreeReportKeywords(
  business: any,
  neighbourhoods: string[] = [],
): FreeReportKeywords {
  const rawCat = resolveSearchCategory(
    business.category || business.userDefinedCategory,
    business.name || business.businessName,
    [business.city, business.area, business.state],
  );
  const cat = tidy(rawCat.replace(SELF_PRAISE, ' ')) || 'business';
  const catShort = shortCategory(cat);
  const city = tidy(business.city || '');
  const brand = brandToken(business.name || business.businessName || '');

  const JUNK_AREA = /^(p\.?\s*o\.?|p\.?\s*s\.?|g\.?p\.?o\.?|post\s*office|ward\s*\d+|zone\s*\d+|[a-z]\s*block)$/i;
  const areas = neighbourhoods
    .map((a) => tidy(a).replace(/\s*[,(]?\s*(p\.?\s*o\.?|post\s*office)\s*[)]?$/i, ''))
    .filter((a) => a && a.length >= 3 && a.toLowerCase() !== city.toLowerCase() && !JUNK_AREA.test(a))
    .slice(0, 7);

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (k?: string) => {
    const v = tidy(k || '');
    const key = v.toLowerCase();
    if (v && v.split(' ').length >= 2 && !seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  };

  // 1. hyper-local: "<Category> <neighbourhood>"
  for (const a of areas) push(`${cat} ${a}`);

  // 2. city workhorses
  if (city) {
    push(`${cat} ${city}`);
    push(`Best ${catShort} ${city}`);
  }

  // 3. brand + city ("Desun Academy Kolkata")
  if (brand && city) push(`${brand} ${city}`);

  // 4. category-noun variants around the nearest area
  if (areas[0]) {
    const noun = /\b(institute|training|classes|academy|school|centre|center)\b/i.test(cat)
      ? `${catShort} courses`
      : catShort;
    push(`${tidy(noun)} ${areas[0]}`);
    push(`${catShort} near ${areas[0]}`);
  } else if (city) {
    push(`${catShort} courses ${city}`);
  }

  // 5. adjacent categories at city level
  const adj = ADJACENT_CATEGORIES.find((a) => a.match.test(cat.toLowerCase()))?.adjacent ?? [];
  for (const a of adj) push(city ? `${a} ${city}` : a);

  const keywords = out.slice(0, 16);
  const fallback = city ? `${cat} ${city}` : cat;
  return {
    keywords: keywords.length ? keywords : [fallback],
    primaryKeyword: keywords[0] || fallback,
    areasUsed: areas,
  };
}
