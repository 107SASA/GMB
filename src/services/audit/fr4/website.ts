/**
 * FR-4.5 website checks. Pure. Uses crawl facts that already exist.
 * Mobile usability and page speed are NOT_MEASURED: this project has no
 * PageSpeed or device measurement, and HTML size is not used as a substitute.
 */

const ABBR: Record<string, string> = {
  rd: 'road', st: 'street', ave: 'avenue', blvd: 'boulevard', ln: 'lane',
  dr: 'drive', no: '', flr: 'floor', fl: 'floor',
};

export function napNormalize(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((t) => (t in ABBR ? ABBR[t] : t))
    .filter(Boolean)
    .join(' ');
}

export function phoneDigits(value: string | null | undefined): string {
  const d = String(value || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

export type NapFieldStatus = 'matched' | 'mismatch' | 'unknown';

function textAgrees(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.includes(short);
}

export function compareNapField(website: string | null | undefined, gbp: string | null | undefined): NapFieldStatus {
  const w = napNormalize(website);
  const g = napNormalize(gbp);
  if (!w || !g) return 'unknown';
  return textAgrees(w, g) ? 'matched' : 'mismatch';
}

export function comparePhone(website: string | null | undefined, gbp: string | null | undefined): NapFieldStatus {
  const w = phoneDigits(website);
  const g = phoneDigits(gbp);
  if (w.length < 8 || g.length < 8) return 'unknown';
  return w === g ? 'matched' : 'mismatch';
}

export interface WebsiteAudit {
  version: 'fr4-v1';
  nap: {
    name: NapFieldStatus;
    address: NapFieldStatus;
    phone: NapFieldStatus;
    overall: NapFieldStatus;
    evidence: string;
  };
  map: { present: boolean | null; status: 'measured' | 'not_measured'; evidence: string[] };
  schema: {
    present: boolean | null;
    types: string[];
    validity: 'VALID' | 'PRESENT' | 'INVALID' | 'ABSENT' | 'UNKNOWN';
    issues: string[];
    /** Never a rich-result eligibility claim. */
    richResultEligible: null;
  };
  mobile: { status: 'NOT_MEASURED'; note: string };
  performance: { status: 'NOT_MEASURED'; note: string };
  https: {
    enabled: boolean | null;
    status: 'measured' | 'not_measured';
    requested: string | null;
    final: string | null;
    redirectedToHttps: boolean | null;
  };
  indexability: {
    status: 'INDEXABLE' | 'NOT_INDEXABLE' | 'PARTIAL' | 'UNKNOWN';
    canonical: string | null;
    robotsMeta: string | null;
    xRobotsTag: string | null;
    robotsTxtDisallowAll: boolean | null;
    sitemapSeen: boolean | null;
    note: string;
  };
}

export interface WebsiteAuditInput {
  /** A page was fetched. Cached intel without crawl signals is not a crawl. */
  crawled: boolean;
  title: string | null;
  phones: string[];
  textSample: string | null;
  schemaTypes: string[];
  jsonLdBlocks: number | null;
  jsonLdErrors: number | null;
  jsonLdUntyped: number | null;
  mapEmbeds: string[] | null;
  requestedUrl: string | null;
  finalUrl: string | null;
  robotsMeta: string | null;
  xRobotsTag: string | null;
  canonical: string | null;
  robotsTxtFetched: boolean | null;
  robotsTxtDisallowAll: boolean | null;
  sitemapSeen: boolean | null;
  pageNoindex: boolean | null;
  gbp: { name: string | null; phone: string | null; address: string | null } | null;
}

const NOT_MEASURED_NOTE = 'No PageSpeed or mobile-usability measurement is configured. HTML from the crawl is not converted into a score.';

export function buildWebsiteAudit(input: WebsiteAuditInput): WebsiteAudit {
  const gbp = input.gbp;
  const name = gbp ? compareNapField(input.title, gbp.name) : 'unknown';
  const phoneStatuses = gbp ? input.phones.map((p) => comparePhone(p, gbp.phone)) : [];
  const phone: NapFieldStatus = !gbp ? 'unknown' : phoneStatuses.includes('matched') ? 'matched' : phoneStatuses.includes('mismatch') ? 'mismatch' : 'unknown';
  // The page is not an address field. Absence of the listing address in the
  // text is unknown, not a mismatch — it may be an image or a map pin.
  let address: NapFieldStatus = 'unknown';
  if (gbp?.address && input.textSample && napNormalize(gbp.address).length >= 8) {
    const norm = napNormalize(gbp.address);
    const page = napNormalize(input.textSample);
    if (page.includes(norm) || (norm.length >= 12 && page.includes(norm.slice(0, 18)))) address = 'matched';
  }
  const parts = [name, address, phone];
  const overall: NapFieldStatus = parts.includes('mismatch') ? 'mismatch' : parts.includes('matched') ? 'matched' : 'unknown';
  const napEvidence = !gbp
    ? 'No verified Google listing was available, so website NAP was not compared.'
    : `Name ${name}, address ${address}, phone ${phone}. Formatting differences are normalised before comparison.`;

  const mapMeasured = input.crawled && input.mapEmbeds != null;
  const map = {
    present: mapMeasured ? input.mapEmbeds!.length > 0 : null,
    status: mapMeasured ? 'measured' as const : 'not_measured' as const,
    evidence: mapMeasured ? input.mapEmbeds! : [],
  };

  let validity: WebsiteAudit['schema']['validity'] = 'UNKNOWN';
  const issues: string[] = [];
  const types = input.schemaTypes || [];
  if (!input.crawled || input.jsonLdBlocks == null) {
    validity = types.length ? 'PRESENT' : 'UNKNOWN';
    if (!input.crawled) issues.push('Structured data was not re-read on this crawl.');
  } else if ((input.jsonLdErrors || 0) > 0 && types.length === 0) {
    validity = 'INVALID';
    issues.push(`${input.jsonLdErrors} JSON-LD block(s) did not parse.`);
  } else if (input.jsonLdBlocks === 0) {
    validity = 'ABSENT';
  } else if ((input.jsonLdUntyped || 0) > 0 || (input.jsonLdErrors || 0) > 0) {
    validity = 'PRESENT';
    if (input.jsonLdErrors) issues.push(`${input.jsonLdErrors} JSON-LD block(s) did not parse.`);
    if (input.jsonLdUntyped) issues.push(`${input.jsonLdUntyped} parsed node(s) have no @type.`);
  } else if (types.length > 0) {
    validity = 'VALID';
    issues.push('JSON-LD parsed and each kept node has @type. This is not a Google rich-result eligibility check.');
  } else {
    validity = 'PRESENT';
    issues.push('JSON-LD parsed but no @type was found.');
  }

  let https: WebsiteAudit['https'];
  try {
    const final = input.finalUrl ? new URL(input.finalUrl) : null;
    const requested = input.requestedUrl ? new URL(input.requestedUrl) : null;
    if (!final || (final.protocol !== 'https:' && final.protocol !== 'http:')) {
      https = { enabled: null, status: 'not_measured', requested: input.requestedUrl, final: input.finalUrl, redirectedToHttps: null };
    } else {
      https = {
        enabled: final.protocol === 'https:',
        status: 'measured',
        requested: requested ? requested.protocol.replace(':', '') : null,
        final: final.protocol.replace(':', ''),
        redirectedToHttps: requested ? requested.protocol === 'http:' && final.protocol === 'https:' : null,
      };
    }
  } catch {
    https = { enabled: null, status: 'not_measured', requested: input.requestedUrl, final: input.finalUrl, redirectedToHttps: null };
  }

  let indexStatus: WebsiteAudit['indexability']['status'] = 'UNKNOWN';
  let indexNote = 'Indexability was not measured. This is not a Google Search Console status.';
  if (input.crawled) {
    const noindex = input.pageNoindex === true || /noindex/i.test(input.robotsMeta || '') || /noindex/i.test(input.xRobotsTag || '');
    if (noindex || input.robotsTxtDisallowAll === true) {
      indexStatus = 'NOT_INDEXABLE';
      indexNote = noindex ? 'A robots meta or X-Robots-Tag says noindex.' : 'robots.txt disallows the whole site.';
    } else if (input.robotsTxtFetched) {
      indexStatus = 'INDEXABLE';
      indexNote = 'Homepage has no noindex and robots.txt does not disallow the whole site. This is not a Search Console index status.';
    } else {
      indexStatus = 'PARTIAL';
      indexNote = 'Homepage has no noindex. robots.txt was not read, so the site is not claimed to be fully indexable.';
    }
  }

  return {
    version: 'fr4-v1',
    nap: { name, address, phone, overall, evidence: napEvidence },
    map,
    schema: {
      present: validity === 'UNKNOWN' ? null : validity !== 'ABSENT',
      types,
      validity,
      issues,
      richResultEligible: null,
    },
    mobile: { status: 'NOT_MEASURED', note: NOT_MEASURED_NOTE },
    performance: { status: 'NOT_MEASURED', note: NOT_MEASURED_NOTE },
    https,
    indexability: {
      status: indexStatus,
      canonical: input.canonical,
      robotsMeta: input.robotsMeta,
      xRobotsTag: input.xRobotsTag,
      robotsTxtDisallowAll: input.robotsTxtDisallowAll,
      sitemapSeen: input.sitemapSeen,
      note: indexNote,
    },
  };
}

export function schemaDimension(audit: WebsiteAudit): { status: 'measured' | 'not_measured' | 'unavailable'; score: number | null; note: string } {
  if (audit.schema.validity === 'UNKNOWN') return { status: 'not_measured', score: null, note: 'Schema was not read.' };
  const score = audit.schema.validity === 'VALID' ? 100 : audit.schema.validity === 'PRESENT' ? 60 : 0;
  return { status: 'measured', score, note: audit.schema.issues[0] || `Schema ${audit.schema.validity}.` };
}

export function websiteDimension(audit: WebsiteAudit): { status: 'measured' | 'not_measured' | 'unavailable'; score: number | null; note: string } {
  const parts: number[] = [];
  if (audit.https.status === 'measured' && audit.https.enabled != null) parts.push(audit.https.enabled ? 100 : 0);
  if (audit.indexability.status === 'INDEXABLE') parts.push(100);
  else if (audit.indexability.status === 'NOT_INDEXABLE') parts.push(0);
  else if (audit.indexability.status === 'PARTIAL') parts.push(50);
  if (audit.map.status === 'measured' && audit.map.present != null) parts.push(audit.map.present ? 100 : 0);
  if (!parts.length) return { status: 'not_measured', score: null, note: 'HTTPS, indexability, and map presence were not measured.' };
  return {
    status: 'measured',
    score: Math.round(parts.reduce((s, n) => s + n, 0) / parts.length),
    note: 'Mean of the website checks that were actually measured. Mobile and speed are excluded.',
  };
}
