/**
 * Fact / policy / quality gate for review replies — pure (runs under `node --test`).
 *
 * A reply may only state what is supported by: the review itself (what the
 * reviewer said), verified business facts (name, category, location,
 * owner/website/GBP services, website excerpts) and the SEO plan's keywords.
 * Rejected: invented services / offers / prices / locations / guarantees /
 * achievements / ratings, claims of work done or problems fixed, facts about
 * the reviewer, competitor claims, ranking promises, promotional pitches,
 * keyword stuffing, and generic replies that ignore what the review said.
 * Nothing that fails this gate is ever published.
 */
import { CLAIMS } from '../content/validatePost.ts';
import { claimsUnknownService, namesUnknownBusiness } from '../audit/validateAudit.ts';

export interface ReplyEvidence {
  businessName: string;
  category?: string;
  /** City, area, and other verified place names for this business. */
  places: string[];
  /** Owner / website / GBP services and the category. */
  services: string[];
  /** Verified website / GBP text the reply may draw on (claims must appear here). */
  factsText: string;
  /** SEO plan keywords (measured + proposed). */
  keywords: string[];
}

export interface ReplyReview {
  text: string;
  rating: number;
  reviewer?: string;
}

export interface ReplyValidation { ok: boolean; reasons: string[] }

const norm = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const STOP = new Set('the and for with this that from have were was are our your you they them their there here what when very just really been also into about more most than then some such only over after before great good nice best thanks thank service services work team place staff time will would could should which while where'.split(' '));
const contentWords = (s: string) => Array.from(new Set(norm(s).match(/[a-z][a-z'-]{3,}/g) || [])).filter((w) => !STOP.has(w));

const PROMISE_RANKING = /\b(rank(?:ing|ed|s)?|google search|search results?|seo|top of google|first page|page one|visibility on google)\b/i;
const PROMO = /\b(call (?:us )?now|book (?:now|today)|limited[- ]time|hurry|don'?t miss|check out our|visit our website|use (?:the )?code|special (?:price|deal|offer)|exclusive (?:offer|deal)|sign up (?:now|today)|order now)\b/i;
const WORK_DONE = /\b(?:we(?:'ve| have)?|our team(?: has)?)\s+(?:already\s+)?(?:fixed|resolved|refunded|replaced|repaired|completed|installed|delivered|renovated|redone|reissued|compensated|credited)\b|\b(?:has|have) been (?:fixed|resolved|refunded|replaced|repaired|addressed)\b|\brefund (?:has been|was) (?:issued|processed)\b/i;
const REVIEWER_FACTS = /\b(?:loyal|regular|long[- ]time|returning|valued long[- ]term) (?:customer|client|patron)\b|\byears? (?:of (?:your )?(?:loyalty|business)|with us)\b|\b(?:your|the) (?:recent )?(?:visit|order|appointment|project|booking|stay|purchase) (?:on|last) (?:mon|tue|wed|thu|fri|sat|sun|\d)/i;
const LOCATION_CLAIM = /\b(?:our|the)\s+(?:[A-Z][a-z]+\s+)?(?:branch|branches|outlet|outlets|showroom|office|offices|clinic|store|studio)\s+(?:in|at|on|near)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)|\b(?:branch|branches|outlets?|locations?|offices?|stores?)\s+(?:in|across|at)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)|\b(?:serving|visit us (?:in|at)|located (?:in|at|on)|based in|come to (?:our|us in))\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/g;
const PLACEHOLDER = /\[[^\]]{2,30}\]|\{\{|<name>|\bXXX\b/i;

export function validateReply(reply: string, review: ReplyReview, ev: ReplyEvidence): ReplyValidation {
  const reasons: string[] = [];
  const text = String(reply || '').trim();
  if (text.length < 15) return { ok: false, reasons: ['reply is empty or too short'] };
  if (text.length > 1200) reasons.push('reply is too long for a review response');
  if (PLACEHOLDER.test(text)) reasons.push('reply contains a placeholder');

  // Claims (superlatives, ratings, numbers, awards, guarantees, offers, testimonials, reputation):
  // allowed only when the same words appear in verified facts OR in the review itself.
  const support = norm(`${ev.factsText} ${review.text}`);
  for (const [re, label] of CLAIMS) {
    for (const m of text.match(re) || []) {
      if (!support.includes(norm(m))) reasons.push(`${label}: "${m.trim()}" is not supported by the review or verified business facts`);
    }
  }
  const lower = norm(text);
  const sentences = text.match(/[^.!?\n]+[.!?]*/g) || [text];
  const ctx = { businessNames: [ev.businessName], places: ev.places, serviceTerms: [...ev.services, ev.category || '', ...ev.keywords].filter(Boolean) };
  for (const s of sentences) {
    const svc = claimsUnknownService(s, ctx);
    if (svc && !norm(review.text).includes(norm(svc).split(' ')[0])) reasons.push(`service not in the verified business facts: "${svc}"`);
    const biz = namesUnknownBusiness(s, ctx);
    if (biz) reasons.push(`mentions another business: "${biz}"`);
  }
  if (/\b(competitors?|other (?:companies|businesses|shops)|unlike (?:others|other))\b/i.test(text)) reasons.push('competitor comparison');
  if (PROMISE_RANKING.test(text)) reasons.push('mentions rankings / search / SEO');
  const promo = text.match(PROMO);
  if (promo) reasons.push(`promotional language: "${promo[0]}"`);
  const done = text.match(WORK_DONE);
  if (done && !norm(review.text).includes('fixed') && !norm(review.text).includes('resolved')) reasons.push(`claims something was done or resolved: "${done[0]}"`);
  const rf = text.match(REVIEWER_FACTS);
  if (rf && !norm(review.text).includes(norm(rf[0]))) reasons.push(`states a fact about the reviewer that the review does not: "${rf[0]}"`);

  // Locations: any place the reply names must be a verified place (or in the review).
  const okPlaces = [...ev.places, ev.businessName].map(norm);
  for (const m of text.matchAll(LOCATION_CLAIM)) {
    const place = (m[1] || m[2] || m[3] || '').trim();
    if (place && !okPlaces.some((p) => p && (p.includes(norm(place)) || norm(place).includes(p))) && !norm(review.text).includes(norm(place))) {
      reasons.push(`location not verified for this business: "${place}"`);
    }
  }
  if (/\b(branches|outlets|locations|franchises)\b/i.test(text) && !/\b(branches|outlets|locations|franchises)\b/i.test(ev.factsText)) reasons.push('claims multiple branches/locations');

  // Keyword stuffing: any SEO keyword more than once, or more than two different keywords.
  const kwHits = ev.keywords.map((k) => ({ k, n: lower.split(norm(k)).length - 1 })).filter((x) => x.k.trim().length > 3 && x.n > 0);
  for (const x of kwHits) if (x.n > 1) reasons.push(`keyword repeated: "${x.k}" ×${x.n}`);
  if (kwHits.length > 2) reasons.push(`too many SEO keywords in one reply (${kwHits.length})`);
  const words = lower.match(/[a-z0-9']+/g) || [];
  const grams = new Map<string, number>();
  for (let i = 0; i + 2 < words.length; i++) {
    const g = words.slice(i, i + 3).join(' ');
    if (g.split(' ').some((w) => w.length > 3 && !STOP.has(w))) grams.set(g, (grams.get(g) || 0) + 1);
  }
  for (const [g, n] of grams) if (n >= 3) reasons.push(`phrase repeated unnaturally: "${g}" ×${n}`);

  // Specific response: a review with substance must be answered on its substance.
  // The business's own vocabulary (name, category, services) doesn't count as
  // engaging with the review — a stock "we provide X" paragraph would match it.
  const reviewWords = contentWords(review.text);
  if (reviewWords.length >= 3) {
    const stem = (w: string) => w.replace(/s$/, '');
    const bizWords = new Set(contentWords([ev.businessName, ev.category, ...ev.services].join(' ')).map(stem));
    const specific = reviewWords.filter((w) => !bizWords.has(stem(w)));
    const replyWords = new Set(contentWords(text).map(stem));
    const target = specific.length >= 2 ? specific : reviewWords;
    const overlap = target.filter((w) => replyWords.has(stem(w)));
    const first = review.reviewer?.split(/\s+/)[0] || '';
    const namesReviewer = first.length > 1 && !/^(a|google|anonymous)$/i.test(first) && lower.includes(norm(first));
    if (!overlap.length && !namesReviewer) reasons.push('generic reply — it does not respond to anything the reviewer said');
  }
  // A review with no details gets a thank-you, not an SEO line.
  if (reviewWords.length < 3) {
    const seo = [...ev.keywords, ...ev.services, ...ev.places].filter((t) => t && t.length > 3).find((t) => lower.includes(norm(t)));
    if (seo) reasons.push(`adds SEO terms ("${seo}") to a reply for a review with no details`);
  }
  // Keyword pasted verbatim ("...renovation Nashik") instead of written as English.
  for (const k of ev.keywords) {
    const place = ev.places.find((p) => p && norm(k).endsWith(` ${norm(p)}`));
    if (place && lower.includes(norm(k)) && !lower.includes(`${norm(k).slice(0, -norm(place).length).trim()} in ${norm(place)}`)) {
      reasons.push(`keyword pasted verbatim: "${k}"`);
    }
  }
  // Tone vs rating: never thank-for-praise a complaint.
  if (review.rating <= 2 && /\b(glad you (?:enjoyed|loved|liked)|happy you (?:enjoyed|loved|liked)|thrilled)\b/i.test(text)) reasons.push('celebratory reply to a negative review');

  return { ok: reasons.length === 0, reasons: Array.from(new Set(reasons)) };
}
