/**
 * ONE profile-completion number, shared by every surface (free-report hero
 * badge, Profile Completion section, PDF export, dashboard report) and by the
 * LLM prompts (Strengths, Key Finding).
 *
 * The bug this exists to kill: `calculateProfileCompletion` returns a
 * percentage computed from Places-visible fields only (Unknown OAuth fields
 * excluded). Pre-OAuth that is frequently 100%. The old UI printed a bare
 * "100% Profile complete" at the top of the report while the Profile
 * Completion section lower down still said "7 fields need verification" — the
 * same report telling two stories — and Groq, fed a bare `100%`, wrote
 * "Full Profile Completion — 100% profile completion" into the Strengths and
 * "its profile is 100% complete" into the Key Finding.
 *
 * The fix is a single qualified wording that every surface quotes verbatim:
 *   "100% of visible fields complete — 7 more fields need a Google connection
 *    to check."
 *
 * Field groups (see calculateProfileCompletion in
 * src/services/audit/seoAnalyzer.ts, which tags every checklist row):
 *   places — verifiable from Google Places before OAuth. These form the
 *            denominator of the pre-OAuth percentage.
 *   oauth  — only knowable once the owner connects Google (GBP Management
 *            API). Never counted as "Missing" pre-OAuth, only "Unknown".
 */

export type CompletionScope = 'places' | 'full';
export type ChecklistGroup = 'places' | 'oauth';

/** Denominator of the pre-OAuth percentage. */
export const PLACES_COMPLETION_FIELDS = [
  'Business Name',
  'Primary Category',
  'Address',
  'Phone',
  'Website',
  'Service Area',
  'Business Hours',
  'Business Photos',
] as const;

/** Require a connected Google account to verify — excluded from the pre-OAuth
 *  percentage, surfaced separately as "N fields need a Google connection". */
export const OAUTH_COMPLETION_FIELDS = [
  'Additional Keywords',
  'Business Description',
  'Services Listed',
  'Social Links',
  'Videos',
  'Logo / Cover Image',
  'Attributes',
  'Booking / Appointment Link',
] as const;

export function groupForField(field: string): ChecklistGroup {
  return (PLACES_COMPLETION_FIELDS as readonly string[]).includes(field) ? 'places' : 'oauth';
}

/** Short, human-readable names for the pending OAuth fields, used in the
 *  parenthetical of the LLM prompt fact. */
const PENDING_FIELD_LABELS: Record<string, string> = {
  'Additional Keywords': 'keywords',
  'Business Description': 'description',
  'Services Listed': 'services',
  'Social Links': 'social links',
  'Videos': 'videos',
  'Logo / Cover Image': 'logo',
  'Attributes': 'attributes',
  'Booking / Appointment Link': 'booking link',
};

interface ChecklistItemLike {
  field: string;
  status: 'Complete' | 'Partial' | 'Missing' | 'Unknown';
  group?: ChecklistGroup;
}

export interface ProfileCompletionLike {
  completionPercentage?: number;
  completionScope?: CompletionScope;
  completionLabel?: string;
  completionPromptFact?: string;
  checklist?: ChecklistItemLike[];
  placesCompleteCount?: number;
  placesTotalCount?: number;
  oauthPendingCount?: number;
  missingCount?: number;
  unknownCount?: number;
}

/** Field names still marked Unknown — i.e. the ones a Google connection would
 *  let us verify. Derived from the checklist so it stays honest if a field
 *  gets promoted (e.g. keywords already present pre-OAuth → not pending). */
export function pendingFieldNames(pc: ProfileCompletionLike): string[] {
  return (pc.checklist ?? [])
    .filter((c) => c.status === 'Unknown')
    .map((c) => PENDING_FIELD_LABELS[c.field] || c.field.toLowerCase());
}

/** The single sentence shown under the Profile Completion heading and reused
 *  as the caveat wherever the percentage appears in prose. */
export function buildCompletionLabel(opts: { pct: number; pending: number; scope: CompletionScope }): string {
  const { pct, pending, scope } = opts;
  if (pending <= 0) {
    return scope === 'full'
      ? `${pct}% of your profile is complete.`
      : `${pct}% of visible fields complete.`;
  }
  return `${pct}% of visible fields complete — ${pending} more field${pending === 1 ? '' : 's'} need a Google connection to check.`;
}

export interface ProfileCompletionDisplay {
  pct: number;
  pending: number;
  scope: CompletionScope;
  label: string;
  /** Caption under the big number in the hero stat tile. Never "Profile
   *  complete" while fields are still unverified — that is the exact
   *  overclaim this module removes. */
  badgeCaption: string;
}

export function formatProfileCompletionDisplay(pc: ProfileCompletionLike | null | undefined): ProfileCompletionDisplay {
  const safe = pc ?? {};
  const pct = Math.round(Number(safe.completionPercentage ?? 0));
  const pending = Number(safe.oauthPendingCount ?? safe.unknownCount ?? 0);
  const scope: CompletionScope = safe.completionScope ?? (pending > 0 ? 'places' : 'full');
  const label = safe.completionLabel || buildCompletionLabel({ pct, pending, scope });
  const badgeCaption = pending > 0 ? 'of visible fields' : 'profile complete';
  return { pct, pending, scope, label, badgeCaption };
}

/** The exact string fed to Groq wherever profile completion is referenced.
 *  Longer and more explicit than the UI label so the model cannot round it
 *  off to "100% complete". */
export function buildCompletionPromptFact(pc: ProfileCompletionLike | null | undefined): string {
  const safe = pc ?? {};
  if (safe.completionPromptFact) return safe.completionPromptFact;

  const pct = Math.round(Number(safe.completionPercentage ?? 0));
  const pending = Number(safe.oauthPendingCount ?? safe.unknownCount ?? 0);
  if (pending <= 0) {
    return `${pct}% of the profile's checkable fields are complete.`;
  }
  const names = pendingFieldNames(safe);
  const nameList = names.length ? ` — ${names.join(', ')} — ` : ' ';
  return `${pct}% of visible fields complete (${pending} field${pending === 1 ? '' : 's'}${nameList}require a Google connection to verify, and are NOT confirmed present)`;
}

/** Drop into any prompt that references profile completion. */
export const COMPLETION_PROMPT_RULE =
  'When you mention profile completion, quote the PROFILE COMPLETION fact above exactly as written. Never shorten it to "100% complete", "fully complete", "full profile completion", or similar — the business has not connected Google, so several fields are unverified, not confirmed present. Do not make profile completeness a headline strength unless the fact says every field is confirmed complete.';

/**
 * Last-resort cleanup: rewrite an over-confident completion claim that a
 * model produced anyway. Runs on generated prose (strengths / weaknesses /
 * key finding / etc.) after parsing.
 */
export function qualifyCompletionInProse(
  text: string | undefined | null,
  fact: string,
  pending: number,
): string {
  if (!text) return text ?? '';
  if (pending <= 0) return text;

  let out = text;

  // "Full Profile Completion" (a strength title) → a truthful title
  out = out.replace(/\bfull profile completion\b/gi, 'Strong Places profile coverage');

  // "100% profile complete" / "100% complete" / "profile is 100% complete" /
  // "100% profile completion" → the qualified fact
  out = out.replace(
    /\b(?:the\s+)?(?:google\s+business\s+)?profile\s+is\s+100%\s+complete\b/gi,
    fact,
  );
  out = out.replace(/\b100%\s+profile\s+completion\b/gi, fact);
  out = out.replace(/\b100%\s+(?:profile\s+)?complete\b/gi, fact);
  out = out.replace(/\bfully\s+complete(?:d)?\s+profile\b/gi, fact);
  out = out.replace(/\bprofile\s+completion\s+of\s+100%\b/gi, fact);

  return out;
}

/** Convenience: qualify a set of string fields on an object in place-ish
 *  (returns a shallow-cloned object). */
export function qualifyCompletionFields<T extends Record<string, unknown>>(
  obj: T,
  fields: string[],
  fact: string,
  pending: number,
): T {
  if (!obj) return obj;
  const clone: Record<string, unknown> = { ...obj };
  for (const f of fields) {
    if (typeof clone[f] === 'string') {
      clone[f] = qualifyCompletionInProse(clone[f] as string, fact, pending);
    }
  }
  return clone as T;
}
