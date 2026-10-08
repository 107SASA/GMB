/**
 * GBP Intelligence → existing Audit / Evidence / SEO Brain inputs.
 * Pure (runs under `node --test`). Nothing here creates a second evidence
 * system: it produces the existing shapes —
 *   - the `gbpLive` object processAuditJob already passes around,
 *   - checklist states for calculateProfileCompletion (fields that used to be
 *     hard-coded "Unknown" become Complete/Missing only when Google answered),
 *   - `Evidence` items (source 'gbp_api') and `Finding`s for findings.ts,
 *   - short verified fact lines for the SeoPlan prompt (not the raw snapshot).
 * Unknown stays Unknown: a section that was never read successfully adds nothing.
 */
import type { Evidence, EvidenceSource, EvidenceState, Finding } from '../../audit/findings.ts';
import type { ExternalChange, GbpSnapshotCore, HealthIssue, Section } from './types.ts';
import { serviceLabel } from './normalize.ts';
import { changeFieldLabel } from './changes.ts';
import { tokenSimilarity } from './duplicates.ts';

export const AUDIT_SNAPSHOT_MAX_AGE_HOURS = 24;

type ChecklistStatus = 'Complete' | 'Missing' | 'Unknown';

const ok = (s?: Section<unknown> | null): boolean => !!s && s.data != null && !!s.meta.lastSuccessfulFetchAt;

/** True when the snapshot's location read is recent enough to replace the audit's own live read. */
export function snapshotUsableForAudit(s: GbpSnapshotCore | null | undefined, now: Date, maxAgeHours = AUDIT_SNAPSHOT_MAX_AGE_HOURS): boolean {
  const at = s?.sections?.location?.meta?.lastSuccessfulFetchAt;
  if (!s || !at || !s.sections.location.data) return false;
  return now.getTime() - new Date(at).getTime() <= maxAgeHours * 3_600_000;
}

/** Same shape as auditService's live `gbpLive` (+ address), from the stored read. */
export function gbpLiveFromSnapshot(s: GbpSnapshotCore) {
  const l = s.sections.location.data!;
  return {
    title: l.title || '',
    description: l.description || '',
    primaryPhone: l.primaryPhone || '',
    website: l.websiteUri || '',
    primaryCategory: l.primaryCategory?.displayName || '',
    additionalCategories: l.additionalCategories.map((c) => c.displayName).filter(Boolean),
    address: l.address?.formatted || '',
  };
}

const SOCIAL_ATTR = /^attributes\/url_(facebook|instagram|twitter|youtube|linkedin|tiktok|pinterest)/;
const BOOKING_ATTR = /^attributes\/url_(appointment|reservations|order_ahead|online_booking)/;

/**
 * Checklist states the snapshot can answer. Fields it cannot answer are
 * omitted so calculateProfileCompletion keeps its own (Unknown) value.
 */
export function checklistStatesFromSnapshot(s: GbpSnapshotCore): Partial<Record<string, ChecklistStatus>> {
  const out: Partial<Record<string, ChecklistStatus>> = {};
  const loc = ok(s.sections.location) ? s.sections.location.data! : null;
  if (loc) {
    out['Business Hours'] = loc.regularHours && loc.regularHours.length > 0 ? 'Complete' : 'Missing';
    // A category Google does not allow services for is not "missing services".
    if (loc.metadata.canModifyServiceList !== false) out['Services Listed'] = loc.services.length > 0 ? 'Complete' : 'Missing';
    if ((loc.serviceArea?.places?.length || 0) > 0) out['Service Area'] = 'Complete';
    else if (loc.serviceArea?.businessType === 'CUSTOMER_LOCATION_ONLY') out['Service Area'] = 'Missing';
  }
  const attrs = ok(s.sections.attributes) ? s.sections.attributes.data! : null;
  if (attrs) {
    out['Attributes'] = attrs.length > 0 ? 'Complete' : 'Missing';
    if (attrs.some((a) => BOOKING_ATTR.test(a.name) && a.value)) out['Booking / Appointment Link'] = 'Complete';
    if (attrs.some((a) => SOCIAL_ATTR.test(a.name) && a.value)) out['Social Links'] = 'Complete';
  }
  const media = ok(s.sections.media) ? s.sections.media.data! : null;
  if (media) {
    // The media list is the OWNER's media only; customer photos/videos are not
    // in it. So zero here never proves "no photos" — only presence is used.
    if (media.photos > 0) out['Business Photos'] = 'Complete';
    if (media.videos > 0) out['Videos'] = 'Complete';
    // Never 'Partial': calculateProfileCompletion and validateAudit count Partial differently.
    out['Logo / Cover Image'] = media.hasLogo || media.hasCover ? 'Complete' : 'Missing';
  }
  return out;
}

/** Checklist field → evidence source when the value came from the GBP API. */
export function fieldSourcesFromSnapshot(s: GbpSnapshotCore): Record<string, EvidenceSource> {
  const out: Record<string, EvidenceSource> = {};
  if (ok(s.sections.location)) {
    for (const f of ['Business Name', 'Primary Category', 'Address', 'Phone', 'Website', 'Business Description', 'Additional Categories']) out[f] = 'gbp_api';
  }
  for (const f of Object.keys(checklistStatesFromSnapshot(s))) out[f] = 'gbp_api';
  return out;
}

function sectionEvidence(id: string, metric: string, section: Section<unknown>, value: unknown, nowIso: string): Evidence {
  const m = section.meta;
  let state: EvidenceState;
  let status: Evidence['status'];
  if (m.status === 'NOT_AVAILABLE') { state = 'NOT_MEASURED'; status = 'unknown'; }
  else if (section.data == null) { state = m.status === 'FAILED' ? 'UNAVAILABLE' : 'UNKNOWN'; status = m.status === 'FAILED' ? 'unavailable' : 'unknown'; }
  else { state = 'VERIFIED'; status = 'verified'; }
  return {
    id,
    metric,
    value: section.data == null ? null : value,
    status,
    source: 'gbp_api',
    confidence: state === 'VERIFIED' ? 'high' : 'low',
    state,
    collectedAt: m.lastSuccessfulFetchAt || m.fetchedAt || nowIso,
  };
}

/** Evidence items for the sections the existing profile checklist does not cover. */
export function gbpIntelligenceEvidence(s: GbpSnapshotCore, now: Date): Evidence[] {
  const nowIso = now.toISOString();
  const sec = s.sections;
  const loc = sec.location.data;
  const today = nowIso.slice(0, 10);
  const media = sec.media.data;
  const posts = sec.posts.data;
  const v = sec.verification.data;
  const dup = sec.duplicates.data;
  const changes = recentMaterialChanges(s, null);
  return [
    sectionEvidence('gbp.hours', 'gbp:regular_hours', sec.location, loc ? (loc.regularHours?.length ? `${loc.regularHours.length} opening periods set` : 'no regular hours set') : null, nowIso),
    sectionEvidence('gbp.special_hours', 'gbp:special_hours', sec.location, loc ? `${loc.specialHours.filter((p) => p.endDate >= today).length} upcoming special-hours entries` : null, nowIso),
    sectionEvidence('gbp.services', 'gbp:services', sec.location, loc ? (loc.services.map(serviceLabel).filter(Boolean).join(', ') || 'no services listed') : null, nowIso),
    sectionEvidence('gbp.attributes', 'gbp:attributes', sec.attributes, sec.attributes.data ? `${sec.attributes.data.length} attributes set` : null, nowIso),
    sectionEvidence('gbp.media', 'gbp:media', sec.media, media ? `${media.photos} owner photos, ${media.videos} videos, logo ${media.hasLogo ? 'set' : 'not set'}, cover ${media.hasCover ? 'set' : 'not set'}` : null, nowIso),
    sectionEvidence('gbp.posts', 'gbp:posts', sec.posts, posts ? `${posts.total}${posts.truncated ? '+' : ''} posts; newest ${posts.newestCreateTime ? posts.newestCreateTime.slice(0, 10) : 'none'}` : null, nowIso),
    sectionEvidence('gbp.verification', 'gbp:verification', sec.verification, v ? `voice of merchant ${v.hasVoiceOfMerchant === true ? 'yes' : v.hasVoiceOfMerchant === false ? 'no' : 'unknown'}; next step ${v.complyWithGuidelines ? `comply with guidelines (${v.complyWithGuidelines.recommendationReason || 'unspecified'})` : v.resolveOwnershipConflict ? 'resolve ownership conflict' : v.verify ? 'verify' : v.waitForVoiceOfMerchant ? 'wait for Google' : 'none'}` : null, nowIso),
    sectionEvidence('gbp.duplicates', 'gbp:duplicates', sec.duplicates, dup ? `Google duplicate flag ${dup.googleFlaggedDuplicateOf ? 'set' : 'not set'}; ${dup.candidates.filter((c) => c.confidence === 'high').length} high-confidence nearby candidates` : null, nowIso),
    sectionEvidence('gbp.changes', 'gbp:external_changes', sec.location, loc ? (changes.map((c) => changeFieldLabel(c.field)).join(', ') || 'none detected') : null, nowIso),
    sectionEvidence('gbp.products', 'gbp:products', sec.products, null, nowIso),
  ];
}

const HIGH_STATES = new Set(['REAUTH_REQUIRED', 'SUSPENDED', 'VERIFICATION_REQUIRED']);

function healthFinding(i: HealthIssue): Finding {
  return {
    id: `gbp.health.${i.code.toLowerCase()}`,
    // Connection / sync problems are data quality, not issues with the business.
    category: i.code === 'AUTH_REVOKED' ? 'data_quality' : 'profile',
    title: i.explanation,
    evidence: `Google Business Profile: ${i.reason}`,
    evidenceIds: [i.source === 'google_places' ? 'gbp.duplicates' : 'gbp.verification'],
    source: i.source === 'google_places' ? 'google_places' : 'gbp_api',
    severity: HIGH_STATES.has(i.state) ? 'high' : 'medium',
    confidence: i.code === 'POSSIBLE_DUPLICATE' ? 'medium' : 'high',
    businessImpact: i.state === 'SUSPENDED'
      ? 'A suspended listing can be hidden from Google Search and Maps.'
      : 'Unresolved profile issues can limit how the listing shows on Google.',
    actionability: i.ownerActionRequired ? 'directly_fixable' : 'monitor_only',
    growwmaticsCapability: null,
    recommendedAction: i.recommendedAction,
  };
}

/** Fields worth surfacing when changed outside GrowwMatics. */
const MATERIAL_CHANGE = new Set(['title', 'primaryPhone', 'website', 'address', 'pin', 'primaryCategory', 'additionalCategories', 'regularHours', 'specialHours', 'openStatus', 'services', 'description']);

export interface FindingContext {
  /** Services the business's own website lists (WebsiteIntelligence) — SOURCE_CLAIMs. */
  websiteServices: string[];
  /** Only changes detected after this date are reported (previous audit). */
  changesSince: Date | null;
  now: Date;
}

/** New findings the snapshot can prove. Existing profile findings (missing hours/photos/services) come from the checklist. */
export function gbpIntelligenceFindings(s: GbpSnapshotCore, ctx: FindingContext): Finding[] {
  const out: Finding[] = [];
  for (const i of s.health.issues) {
    if (i.code === 'SYNC_FAILED') continue; // our own sync state, not a business issue
    out.push(healthFinding(i));
  }

  const loc = ok(s.sections.location) ? s.sections.location.data! : null;
  // GBP lists services the website never mentions → website/local SEO alignment.
  if (loc && loc.services.length && ctx.websiteServices.length) {
    const gbpServices = loc.services.map(serviceLabel).filter(Boolean);
    const notOnSite = gbpServices.filter((g) => !ctx.websiteServices.some((w) => tokenSimilarity(g, w) >= 0.5));
    if (notOnSite.length) {
      out.push({
        id: 'website.gbp_services_not_on_site',
        category: 'website',
        title: `Your Google profile lists ${notOnSite.length} service${notOnSite.length === 1 ? '' : 's'} your website does not mention`,
        evidence: `Google Business Profile services: ${notOnSite.slice(0, 6).join(', ')} · not found among the services your website lists`,
        evidenceIds: ['gbp.services', 'website.services'],
        source: 'gbp_api',
        severity: 'low',
        confidence: 'medium',
        businessImpact: 'A website page per real service helps Google connect the listing and the site.',
        actionability: 'directly_fixable',
        growwmaticsCapability: null,
        recommendedAction: `Add website content for these services if you offer them: ${notOnSite.slice(0, 4).join(', ')}.`,
      });
    }
  }

  const attrs = ok(s.sections.attributes) ? s.sections.attributes.data! : null;
  if (attrs && attrs.length === 0) {
    out.push({
      id: 'gbp.attributes.none',
      category: 'profile',
      title: 'No attributes are set on the Google profile',
      evidence: 'Google Business Profile attributes: none set',
      evidenceIds: ['gbp.attributes'],
      source: 'gbp_api',
      severity: 'low',
      confidence: 'high',
      businessImpact: 'Attributes are facts customers filter on in Google Maps.',
      actionability: 'directly_fixable',
      growwmaticsCapability: null,
      recommendedAction: 'Review which attributes genuinely apply to your business and set only those in Google Business Profile.',
    });
  }

  const posts = ok(s.sections.posts) ? s.sections.posts.data! : null;
  if (posts) {
    const newest = posts.newestCreateTime ? new Date(posts.newestCreateTime) : null;
    const days = newest ? Math.floor((ctx.now.getTime() - newest.getTime()) / 86_400_000) : null;
    if (!newest || (days != null && days > 30)) {
      out.push({
        id: 'gbp.posts.stale',
        category: 'profile',
        title: newest ? `No Google post in the last ${days} days` : 'No Google posts on the profile',
        evidence: newest ? `Google Business Profile: newest post ${newest.toISOString().slice(0, 10)}` : 'Google Business Profile: no posts returned',
        evidenceIds: ['gbp.posts'],
        source: 'gbp_api',
        severity: 'low',
        confidence: 'high',
        businessImpact: 'Recent posts show searchers the business is active.',
        actionability: 'directly_fixable',
        growwmaticsCapability: 'google_posts',
        recommendedAction: 'Publish a short post about a real service or update each week.',
      });
    }
  }

  for (const c of recentMaterialChanges(s, ctx.changesSince)) {
    out.push({
      id: `gbp.change.${c.field}`,
      category: 'profile',
      title: `${changeFieldLabel(c.field)} changed on Google outside GrowwMatics`,
      evidence: `${changeFieldLabel(c.field)}: ${c.previousValue ?? '(empty)'} → ${c.newValue ?? '(empty)'} (detected ${c.detectedAt.slice(0, 10)}${c.source === 'GOOGLE_SUGGESTED_EDIT' ? ', Google-updated field' : ''})`,
      evidenceIds: ['gbp.changes'],
      source: 'gbp_api',
      severity: c.field === 'title' || c.field === 'address' || c.field === 'primaryCategory' || c.field === 'primaryPhone' ? 'medium' : 'low',
      confidence: 'high',
      businessImpact: 'Changes to core listing details affect what searchers see and how Google ranks the listing.',
      actionability: 'monitor_only',
      growwmaticsCapability: null,
      recommendedAction: 'Confirm this change is correct in Google Business Profile; correct it there if it is not.',
    });
  }
  return out;
}

export function recentMaterialChanges(s: GbpSnapshotCore, since: Date | null): ExternalChange[] {
  const seen = new Set<string>();
  return (s.externalChanges || [])
    .filter((c) => c.source !== 'GROWMATICS_EDIT' && MATERIAL_CHANGE.has(c.field))
    .filter((c) => !since || new Date(c.detectedAt) > since)
    .filter((c) => (seen.has(c.field) ? false : (seen.add(c.field), true))) // newest per field
    .slice(0, 8);
}

/**
 * Compact, verified fact lines for the SeoPlan prompt. Only sections Google
 * answered appear; each line says what it is. Never the raw payload.
 */
export function seoBrainGbpLines(s: GbpSnapshotCore, ctx: { changesSince: Date | null; now: Date }): string[] {
  const lines: string[] = [];
  const sec = s.sections;
  const loc = ok(sec.location) ? sec.location.data! : null;
  const today = ctx.now.toISOString().slice(0, 10);
  if (loc) {
    lines.push(`Primary category: ${loc.primaryCategory?.displayName || '(not set)'}; additional categories: ${loc.additionalCategories.map((c) => c.displayName).join(', ') || 'none'}`);
    lines.push(`Services listed on Google: ${loc.services.map(serviceLabel).filter(Boolean).slice(0, 15).join(', ') || 'none'}`);
    lines.push(`Opening hours: ${loc.regularHours?.length ? 'set' : 'not set'}; upcoming special hours: ${loc.specialHours.filter((p) => p.endDate >= today).length}`);
    lines.push(`Description on Google: ${loc.description ? `${loc.description.length} characters` : 'empty'}`);
    if (loc.serviceArea?.places?.length) lines.push(`Service area: ${loc.serviceArea.places.map((p) => p.placeName).filter(Boolean).slice(0, 8).join(', ')}`);
    if (loc.openInfo?.status && loc.openInfo.status !== 'OPEN') lines.push(`Open status on Google: ${loc.openInfo.status}`);
  }
  if (ok(sec.attributes)) lines.push(`Attributes set on Google: ${sec.attributes.data!.length}`);
  if (ok(sec.media)) {
    const m = sec.media.data!;
    lines.push(`Owner photos on Google: ${m.photos}; videos: ${m.videos}; logo ${m.hasLogo ? 'set' : 'not set'}; cover ${m.hasCover ? 'set' : 'not set'}`);
  }
  if (ok(sec.posts)) {
    const p = sec.posts.data!;
    lines.push(`Google posts: ${p.total}${p.truncated ? '+' : ''}; newest ${p.newestCreateTime ? p.newestCreateTime.slice(0, 10) : 'none'}`);
  }
  if (ok(sec.reviews)) {
    const r = sec.reviews.data!;
    lines.push(`Reviews synced: ${r.storedCount}${r.googleTotalCount != null ? ` of ${r.googleTotalCount} on Google` : ''}; unreplied: ${r.unrepliedCount}`);
  }
  const issues = s.health.issues.filter((i) => i.code !== 'SYNC_FAILED');
  if (issues.length) lines.push(`Profile health (from Google): ${issues.map((i) => i.code).join(', ')}`);
  if (sec.duplicates.data?.candidates.some((c) => c.confidence === 'high')) lines.push('Possible duplicate Google listing nearby (unconfirmed).');
  for (const c of recentMaterialChanges(s, ctx.changesSince)) {
    lines.push(`Changed on Google outside GrowwMatics: ${changeFieldLabel(c.field)} (${c.detectedAt.slice(0, 10)})`);
  }
  if (sec.products.meta.status === 'NOT_AVAILABLE') lines.push('Products: not readable through the Google API (do not mention products).');
  return lines;
}

/** Services Google lists — verified, usable as the business's own services. */
export function gbpServiceNames(s: GbpSnapshotCore): string[] {
  if (!ok(s.sections.location)) return [];
  return s.sections.location.data!.services.map(serviceLabel).filter(Boolean);
}

/** Small, UI/report-safe summary stored on the audit (no raw payloads). */
export function auditGbpIntelligenceSummary(s: GbpSnapshotCore) {
  return {
    source: 'gbp_api' as const,
    fetchedAt: s.fetchedAt,
    lastSuccessfulSyncAt: s.lastSuccessfulSyncAt,
    healthState: s.health.state,
    healthIssues: s.health.issues.map((i) => i.code),
    sections: Object.fromEntries(Object.entries(s.sections).map(([k, v]) => [k, { status: v.meta.status, lastSuccessfulFetchAt: v.meta.lastSuccessfulFetchAt }])),
  };
}
