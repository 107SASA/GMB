/**
 * Findings added only when a website check was actually measured.
 * Severity stays inside the existing high | medium | low union so
 * OptimizationAction.priority (that same union) keeps validating.
 * Critical is applied later, only on the FR-4 issue view.
 */

import type { Finding } from '../findings.ts';
import type { WebsiteAudit } from './website.ts';

export function websiteFindings(audit: WebsiteAudit): Finding[] {
  const out: Finding[] = [];
  if (audit.nap.overall === 'mismatch') {
    const phone = audit.nap.phone === 'mismatch';
    out.push({
      id: 'website.nap_mismatch',
      category: 'website',
      title: phone ? 'Website phone does not match the Google listing' : 'Website name does not match the Google listing',
      evidence: audit.nap.evidence,
      evidenceIds: ['website.nap'],
      source: 'calculated',
      severity: 'high',
      confidence: 'high',
      businessImpact: 'Customers who move between the website and Google see different contact details.',
      actionability: 'directly_fixable',
      growwmaticsCapability: phone ? 'update_phone' : audit.nap.name === 'mismatch' ? 'update_title' : null,
      recommendedAction: phone
        ? 'Approve the phone number that should appear on both the website and the Google listing.'
        : 'Align the business name on the website with the name on the Google listing.',
    });
  }
  if (audit.map.status === 'measured' && audit.map.present === false) {
    out.push({
      id: 'website.map_missing',
      category: 'website',
      title: 'Website has no Google Map',
      evidence: 'The crawled pages have no Google Maps iframe, embed, or Maps URL. An address on the page is not counted as a map.',
      evidenceIds: ['website.map'],
      source: 'website',
      severity: 'low',
      confidence: 'high',
      businessImpact: 'Visitors cannot open the listing from a map on the site.',
      actionability: 'directly_fixable',
      growwmaticsCapability: null,
      recommendedAction: 'Add a Google Maps embed that points at the verified listing.',
    });
  }
  if (audit.schema.validity === 'INVALID') {
    out.push({
      id: 'website.schema_invalid',
      category: 'website',
      title: 'Website structured data is invalid',
      evidence: audit.schema.issues.join(' ') || 'JSON-LD did not parse.',
      evidenceIds: ['website.schema'],
      source: 'website',
      severity: 'medium',
      confidence: 'high',
      businessImpact: 'Broken structured data cannot be read by search engines.',
      actionability: 'directly_fixable',
      growwmaticsCapability: null,
      recommendedAction: 'Replace the malformed JSON-LD. This check does not say whether a rich result would be eligible.',
    });
  } else if (audit.schema.validity === 'ABSENT') {
    out.push({
      id: 'website.schema_missing',
      category: 'website',
      title: 'Website has no structured data',
      evidence: 'The crawl found no JSON-LD blocks.',
      evidenceIds: ['website.schema'],
      source: 'website',
      severity: 'medium',
      confidence: 'high',
      businessImpact: 'Search engines receive no structured description of the business from the site.',
      actionability: 'directly_fixable',
      growwmaticsCapability: null,
      recommendedAction: 'Add JSON-LD that describes the business. This check does not award rich-result eligibility.',
    });
  }
  if (audit.https.status === 'measured' && audit.https.enabled === false) {
    out.push({
      id: 'website.https_off',
      category: 'website',
      title: 'Website did not load over HTTPS',
      evidence: `Requested ${audit.https.requested || 'unknown'}, final response ${audit.https.final || 'unknown'}.`,
      evidenceIds: ['website.https'],
      source: 'website',
      severity: 'high',
      confidence: 'high',
      businessImpact: 'Browsers mark an HTTP page as not secure.',
      actionability: 'directly_fixable',
      growwmaticsCapability: null,
      recommendedAction: 'Serve the site over HTTPS. A redirect is recorded only when this crawl followed one.',
    });
  }
  if (audit.indexability.status === 'NOT_INDEXABLE') {
    out.push({
      id: 'website.not_indexable',
      category: 'website',
      title: 'Website tells crawlers not to index it',
      evidence: audit.indexability.note,
      evidenceIds: ['website.indexability'],
      source: 'website',
      severity: 'high',
      confidence: 'high',
      businessImpact: 'A noindex tag or a site-wide robots.txt block keeps the site out of search results.',
      actionability: 'directly_fixable',
      growwmaticsCapability: null,
      recommendedAction: 'Remove the noindex or the site-wide disallow if the site should be indexed. This is not a Search Console status.',
    });
  }
  return out;
}
