/**
 * GBP Intelligence — shared types (pure, no imports; runs under `node --test`).
 *
 * One GbpLocationSnapshot per business holds what Google Business Profile
 * currently says about the listing, section by section. Every section keeps
 * its own sync metadata so a failed section never erases the last good data:
 *
 *   SUCCESS       — fetched this sync; `data` is Google's current value
 *                   (an empty list here means Google returned none — verified empty)
 *   FAILED        — the request failed; `data` is still the LAST SUCCESSFUL value
 *   NOT_AVAILABLE — no Business Profile API exposes this (e.g. products)
 *   NOT_FETCHED   — never fetched yet (unknown — never treat as empty)
 *
 * Google-sourced data only. Owner input stays on Business; GrowwMatics-created
 * posts stay in Post; nothing here is written back to those collections.
 */

export type SectionStatus = 'SUCCESS' | 'FAILED' | 'NOT_AVAILABLE' | 'NOT_FETCHED';

export type GoogleErrorCategory =
  | 'AUTHENTICATION'   // token invalid / revoked
  | 'AUTHORIZATION'    // 403 permission on this resource
  | 'CONFIGURATION'    // API not enabled on the Cloud project, billing disabled
  | 'RATE_LIMIT'       // 429 / quota
  | 'NOT_FOUND'        // 404 (location removed / not visible to this account)
  | 'TEMPORARY'        // 5xx, network
  | 'VALIDATION'       // 400 bad request
  | 'UNKNOWN';

export interface SectionError {
  category: GoogleErrorCategory;
  httpStatus?: number | null;
  message: string;
}

export interface SectionMeta {
  status: SectionStatus;
  /** Last attempt (success or failure). */
  fetchedAt: string | null;
  lastSuccessfulFetchAt: string | null;
  error?: SectionError | null;
  /** Why the section has no data (NOT_AVAILABLE), or other context. */
  note?: string | null;
}

export interface Section<T> {
  meta: SectionMeta;
  /** Last successful value — kept untouched when a later fetch fails. */
  data: T | null;
}

// ── Normalized Google data ────────────────────────────────────────────────

export interface TimeOfDayHM { hours: number; minutes: number }

export interface HoursPeriod {
  openDay: string;
  openTime: string;   // "HH:MM" (24h)
  closeDay: string;
  closeTime: string;  // "HH:MM"
}

export interface SpecialHoursPeriod {
  startDate: string;  // "YYYY-MM-DD"
  endDate: string;    // "YYYY-MM-DD" (= startDate when Google omits it)
  closed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

export interface GbpCategory {
  /** Google category resource, e.g. "categories/gcid:dentist". */
  name: string;
  displayName: string;
}

export interface GbpServiceItem {
  kind: 'structured' | 'free_form';
  /** Structured: serviceTypeId (e.g. "job_type_id:…"); free form: category id. */
  id: string | null;
  displayName: string | null;
  description: string | null;
  price: { currencyCode: string; units: string; nanos: number } | null;
}

export interface GbpAddress {
  addressLines: string[];
  locality: string | null;
  sublocality: string | null;
  administrativeArea: string | null;
  postalCode: string | null;
  regionCode: string | null;
  /** Lines + locality + area + postal code, the same flattening gbpClient uses. */
  formatted: string;
}

export interface GbpLocationData {
  /** "locations/{id}" */
  resourceName: string;
  title: string | null;
  storeCode: string | null;
  languageCode: string | null;
  primaryPhone: string | null;
  additionalPhones: string[];
  websiteUri: string | null;
  address: GbpAddress | null;
  latlng: { latitude: number; longitude: number } | null;
  primaryCategory: GbpCategory | null;
  additionalCategories: GbpCategory[];
  description: string | null;
  /** null = Google returned no regularHours (no hours set). */
  regularHours: HoursPeriod[] | null;
  specialHours: SpecialHoursPeriod[];
  moreHoursTypes: string[];
  serviceArea: {
    businessType: string | null;
    places: Array<{ placeName: string | null; placeId: string | null }>;
    regionCode: string | null;
  } | null;
  services: GbpServiceItem[];
  openInfo: { status: string | null; canReopen: boolean | null; openingDate: string | null } | null;
  metadata: {
    placeId: string | null;
    mapsUri: string | null;
    newReviewUri: string | null;
    hasGoogleUpdated: boolean;
    hasPendingEdits: boolean;
    hasVoiceOfMerchant: boolean | null;
    canOperateLocalPost: boolean | null;
    canModifyServiceList: boolean | null;
    duplicateLocation: string | null;
  };
}

export interface GbpAttribute {
  /** "attributes/has_wheelchair_accessible_entrance" */
  name: string;
  /** Readable label derived from the attribute id (no extra metadata call). */
  label: string;
  valueType: string | null;
  /** Canonical string form used for change detection and display. */
  value: string;
}

export interface GbpVerificationState {
  hasVoiceOfMerchant: boolean | null;
  hasBusinessAuthority: boolean | null;
  /** Which action Google says is next (absent = none). */
  waitForVoiceOfMerchant: boolean;
  verify: { hasPendingVerification: boolean } | null;
  resolveOwnershipConflict: boolean;
  complyWithGuidelines: { recommendationReason: string | null } | null;
}

export interface GbpMediaSummary {
  total: number;
  byCategory: Record<string, number>;
  photos: number;
  videos: number;
  hasLogo: boolean;
  hasCover: boolean;
  newestCreateTime: string | null;
  /** Media list is the owner/merchant media only (customer media not fetched). */
  scope: 'owner_media';
}

export interface GbpPostSummaryItem {
  name: string;
  topicType: string | null;
  state: string | null;
  summary: string | null;
  createTime: string | null;
  updateTime: string | null;
  searchUrl: string | null;
  callToAction: string | null;
}

export interface GbpPostsSummary {
  total: number;
  byTopicType: Record<string, number>;
  live: number;
  newestCreateTime: string | null;
  /** True when pagination stopped at the page cap before the end of the list. */
  truncated: boolean;
  recent: GbpPostSummaryItem[];
}

export interface GbpReviewsSummary {
  /** Google's own lifetime totals (from the review sync). */
  googleTotalCount: number | null;
  googleAverageRating: number | null;
  /** Reviews stored in GrowwMatics for this business. */
  storedCount: number;
  unrepliedCount: number;
  newestReviewAt: string | null;
  /** storedCount >= googleTotalCount; null when Google's total is unknown. */
  complete: boolean | null;
  lastSyncMode: string | null;
  lastSyncAt: string | null;
  /** Reviews skipped because another workspace already holds the same review id. */
  conflicts: number;
}

export interface GbpGoogleUpdates {
  /** Fields where Google's version differs from the merchant's (diffMask). */
  diffFields: string[];
  /** Fields with edits pending Google review (pendingMask). */
  pendingFields: string[];
  /** Google's proposed values for the differing fields, normalized. */
  googleValues: Record<string, string>;
}

export interface DuplicateCandidate {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  distanceMeters: number | null;
  signals: string[];
  confidence: 'high' | 'medium' | 'low';
  score: number;
}

export interface GbpDuplicates {
  /** Google's own flag on the location (metadata.duplicateLocation). */
  googleFlaggedDuplicateOf: string | null;
  candidates: DuplicateCandidate[];
  /** When Places was last searched (cache). */
  placesCheckedAt: string | null;
  /** NAP fingerprint the Places search ran for — re-search when it changes. */
  napFingerprint: string | null;
}

export type ChangeSource = 'GOOGLE_EXTERNAL_CHANGE' | 'GROWMATICS_EDIT' | 'GOOGLE_SUGGESTED_EDIT';

export interface ExternalChange {
  field: string;
  previousValue: string | null;
  newValue: string | null;
  source: ChangeSource;
  changeType: 'added' | 'removed' | 'modified';
  detectedAt: string;
}

export type HealthState =
  | 'HEALTHY'
  | 'REAUTH_REQUIRED'
  | 'SUSPENDED'
  | 'VERIFICATION_REQUIRED'
  | 'VERIFICATION_PENDING'
  | 'NEEDS_ATTENTION'
  | 'SYNC_ERROR'
  | 'UNKNOWN';

export interface HealthIssue {
  code: string;
  state: HealthState;
  source: 'gbp_api' | 'gbp_verifications_api' | 'oauth' | 'google_places' | 'sync';
  reason: string;
  explanation: string;
  recommendedAction: string;
  ownerActionRequired: boolean;
  /** Where the owner fixes it (Google's own UI), when there is one. */
  helpUrl: string | null;
  detectedAt: string;
}

export interface GbpHealth {
  state: HealthState;
  issues: HealthIssue[];
  lastCheckedAt: string;
}

export interface GbpSnapshotSections {
  location: Section<GbpLocationData>;
  attributes: Section<GbpAttribute[]>;
  verification: Section<GbpVerificationState>;
  media: Section<GbpMediaSummary>;
  posts: Section<GbpPostsSummary>;
  reviews: Section<GbpReviewsSummary>;
  googleUpdates: Section<GbpGoogleUpdates>;
  duplicates: Section<GbpDuplicates>;
  products: Section<never[]>;
}

export type SyncReason = 'connect' | 'scheduled' | 'manual' | 'unknown';

export interface GbpSnapshotCore {
  businessId: string;
  accountId: string | null;
  locationId: string | null;
  placeId: string | null;
  source: 'GOOGLE_BUSINESS_PROFILE';
  schemaVersion: number;
  fetchedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncReason: SyncReason | null;
  lastSyncOutcome: 'SUCCESS' | 'PARTIAL' | 'FAILED' | null;
  sections: GbpSnapshotSections;
  externalChanges: ExternalChange[];
  health: GbpHealth;
}

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const MAX_STORED_CHANGES = 100;
