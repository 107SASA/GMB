/**
 * Evidence gate for generated GBP posts — pure (runs under `node --test`).
 *
 * A post may only state what the evidence supports: verified business facts,
 * what the website SAYS (source claims), owner-confirmed information, the
 * owner's own offer text, and the dated festival calendar. Superlatives,
 * numbers, discounts, awards, guarantees, customer results and invented
 * services are rejected unless the exact claim appears in that evidence.
 * A rejected post is regenerated once, then saved as a DRAFT — never
 * scheduled automatically.
 */
import { claimsFabricatedOutcome, claimsUnknownService, namesUnknownBusiness } from '../audit/validateAudit.ts';

export interface PostDraft { title: string; body: string; cta?: string; hashtags?: string[] }

export interface PostEvidence {
  businessName: string;
  /** Every verified / source-claim / owner text the post may draw on (lower-cased match). */
  evidenceText: string;
  serviceTerms: string[];
  places: string[];
  businessNames: string[];
  /** Owner's exact offer text for an offer slot — the only source of offer language. */
  offerText?: string | null;
  festivalName?: string | null;
  phone?: string | null;
  website?: string | null;
}

export interface PostValidation { ok: boolean; reasons: string[] }

/** Claim patterns → reason. A match is allowed only when evidenceText (or the offer) contains the same wording. */
export const CLAIMS: Array<[RegExp, string]> = [
  [/\b(best|#\s?1|no\.?\s?1|number one|top[- ]rated|leading|premier|finest|unmatched|unbeatable|world[- ]class|award[- ]winning)\b/gi, 'superlative'],
  [/\bthe top\b|\btop (choice|provider|company|agency|firm|institute|clinic|brand|service)\b/gi, 'superlative'],
  [/\b(5|five)[- ]star\b|\b\d(\.\d)?\s?(★|stars?)\b/gi, 'rating claim'],
  [/\b\d+(\.\d+)?\s?%/g, 'percentage'],
  [/\b\d+\+?\s*(years?|yrs?)\b/gi, 'years of experience'],
  [/\b\d[\d,]*\+?\s*(happy |satisfied )?(clients|customers|businesses|projects|students|patients|users|companies)\b/gi, 'customer/project count'],
  [/\b(award(ed|s)?|certified|certification|accredited|iso\s?\d{3,5}|licen[cs]ed|government[- ]approved)\b/gi, 'award / credential'],
  [/\bguarantee(d|s)?\b|\bmoney[- ]back\b|\brisk[- ]free\b/gi, 'guarantee'],
  // Promotional language only — "we offer web design" is a verb, not an offer.
  [/\b(discount(s|ed)?|special offer|limited[- ]time( offer)?|offer (valid|ends|price|period)|on sale|festive sale|clearance sale|deal of the \w+|coupon|cashback|flat \d+|\d+\s?off\b|free (consultation|trial|demo|quote|session|class|delivery|installation|audit|visit))\b/gi, 'offer / discount'],
  [/\b(testimonial|customers (say|love)|clients (say|love)|rave reviews|trusted by|loved by)\b/gi, 'testimonial / customer claim'],
  [/\b(most )?trusted\b|\bmost reliable\b|\bhighly (rated|recommended|experienced)\b/gi, 'reputation claim'],
];

const has = (hay: string, needle: string) => hay.includes(needle.toLowerCase().replace(/\s+/g, ' ').trim());

export function validatePost(post: PostDraft, ev: PostEvidence): PostValidation {
  const reasons: string[] = [];
  const text = [post.title, post.body, post.cta, ...(post.hashtags || [])].filter(Boolean).join('. ');
  const evidence = `${ev.evidenceText} ${ev.offerText || ''}`.toLowerCase().replace(/\s+/g, ' ');

  for (const [re, label] of CLAIMS) {
    for (const m of text.match(re) || []) {
      if (!has(evidence, m)) reasons.push(`${label}: "${m.trim()}" is not in the verified evidence${label === 'offer / discount' ? ' or the owner\'s offer' : ''}`);
    }
  }
  const sentences = text.match(/[^.!?\n]+[.!?]*/g) || [text];
  for (const sn of sentences) {
    if (claimsFabricatedOutcome(sn)) reasons.push(`predicted outcome: "${sn.trim().slice(0, 80)}"`);
    const ctx = { businessNames: [ev.businessName, ...ev.businessNames], places: ev.places, serviceTerms: ev.serviceTerms };
    const svc = claimsUnknownService(sn, ctx);
    if (svc) reasons.push(`service not in the evidence: "${svc}"`);
    const biz = namesUnknownBusiness(sn, ctx);
    if (biz) reasons.push(`business not in the evidence: "${biz}"`);
  }
  // Contact details: only the business's own.
  const digits = (s: string) => s.replace(/\D/g, '');
  for (const m of text.match(/\+?\d[\d\s-]{8,}\d/g) || []) {
    if (!ev.phone || !digits(ev.phone).endsWith(digits(m).slice(-10))) reasons.push(`phone number not on the listing: "${m}"`);
  }
  for (const m of text.match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|in|net|org|co|io|biz|info)(?:\/\S*)?/gi) || []) {
    const host = m.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
    const own = String(ev.website || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
    if (!own || host !== own) reasons.push(`link not the business's website: "${m}"`);
  }
  // A customer-facing post never talks about its own SEO.
  const meta = text.match(/\bkeywords?\b|\bSEO\b|\bsearch engines?\b|\bwhen you search\b|\bsearch(?:es|ing)? for [a-z ]*\b(?:near me|in [A-Z]?[a-z]+)\b/i);
  if (meta) reasons.push(`SEO meta-language in the post: "${meta[0]}"`);
  if (ev.festivalName === null &&/\b(diwali|holi|eid|christmas|navratri|dussehra|ganesh chaturthi|new year)\b/i.test(text)) {
    reasons.push('festival mentioned outside a festival slot');
  }
  return { ok: reasons.length === 0, reasons: Array.from(new Set(reasons)) };
}
