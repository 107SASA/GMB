/**
 * Super admin CRM rules — pure, so tests load them directly. The CRM is the
 * Lead Engine itself (Lead, tenantId 'gmbboost-internal'): the stages a team
 * member sets here are the same `currentStage` the AI agents move a lead
 * through, so the AI and the team never keep two different pipelines.
 */
import { normalizePhoneE164 } from '../phone.ts';
import { usablePersonName } from '../personName.ts';

export type CrmStage =
  | 'NEW' | 'QUALIFYING' | 'NURTURING' | 'DEMO_REQUESTED' | 'DEMO_SCHEDULED'
  | 'DEMO_COMPLETED' | 'CONVERSION_PENDING' | 'PAYMENT_VERIFIED' | 'CUSTOMER'
  | 'COLD' | 'UNRESPONSIVE' | 'LONG_TERM_NURTURE' | 'LOST' | 'DO_NOT_CONTACT'
  | 'HUMAN_HANDOFF';

export type CrmStageGroup = 'open' | 'demo' | 'closing' | 'won' | 'inactive' | 'lost';

export interface CrmStageDef {
  value: CrmStage;
  label: string;
  group: CrmStageGroup;
  /** False: set by the system only (a human takes over from the Inbox). */
  settable: boolean;
}

export const CRM_STAGES: CrmStageDef[] = [
  { value: 'NEW', label: 'New', group: 'open', settable: true },
  { value: 'QUALIFYING', label: 'Qualifying', group: 'open', settable: true },
  { value: 'NURTURING', label: 'Nurturing', group: 'open', settable: true },
  { value: 'DEMO_REQUESTED', label: 'Demo requested', group: 'demo', settable: true },
  { value: 'DEMO_SCHEDULED', label: 'Demo scheduled', group: 'demo', settable: true },
  { value: 'DEMO_COMPLETED', label: 'Demo completed', group: 'demo', settable: true },
  { value: 'CONVERSION_PENDING', label: 'Payment pending', group: 'closing', settable: true },
  { value: 'PAYMENT_VERIFIED', label: 'Payment verified', group: 'closing', settable: true },
  { value: 'CUSTOMER', label: 'Customer', group: 'won', settable: true },
  { value: 'COLD', label: 'Cold', group: 'inactive', settable: true },
  { value: 'UNRESPONSIVE', label: 'Unresponsive', group: 'inactive', settable: true },
  { value: 'LONG_TERM_NURTURE', label: 'Long-term nurture', group: 'inactive', settable: true },
  { value: 'LOST', label: 'Lost', group: 'lost', settable: true },
  { value: 'DO_NOT_CONTACT', label: 'Do not contact', group: 'lost', settable: true },
  { value: 'HUMAN_HANDOFF', label: 'With a human', group: 'open', settable: false },
];

export const CRM_STAGE_GROUPS: { key: CrmStageGroup; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'demo', label: 'Demo' },
  { key: 'closing', label: 'Closing' },
  { key: 'won', label: 'Won' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'lost', label: 'Lost' },
];

export const crmStageDef = (value: unknown): CrmStageDef | undefined => CRM_STAGES.find((s) => s.value === value);
export const crmStageLabel = (value: unknown): string => crmStageDef(value)?.label ?? 'New';

/** A stage typed by a person or in a CSV ("demo scheduled", "Demo_Scheduled", "LOST") → its value, or null. */
export function parseCrmStage(text: unknown): CrmStage | null {
  const t = String(text ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!t) return null;
  const hit = CRM_STAGES.find((s) => s.value.toLowerCase() === t || s.label.toLowerCase().replace(/[\s-]+/g, '_') === t);
  return hit && hit.settable ? hit.value : null;
}

/** Sources allowed on a Lead (models/Lead.ts). */
export const CRM_SOURCES = [
  'Website Free Report', 'Website Demo Booking', 'WhatsApp Free Report',
  'WhatsApp', 'Website', 'Manual', 'Instagram', 'Facebook', 'Referral', 'Demo Booking',
  'Google Business Profile', 'Phone Call', 'Contacts Import', 'CSV Import', 'Campaign Import', 'Appointment',
] as const;
export type CrmSource = (typeof CRM_SOURCES)[number];

export function parseCrmSource(text: unknown, fallback: CrmSource): CrmSource {
  const t = String(text ?? '').trim().toLowerCase();
  return CRM_SOURCES.find((s) => s.toLowerCase() === t) ?? fallback;
}

/**
 * What to call a lead anywhere in the CRM: their real name, else their
 * business, else their number — never "Unknown" or "New User".
 */
export function crmDisplayName(lead: { name?: string | null; businessType?: string | null; phone?: string | null }): string {
  return usablePersonName(lead.name, lead.businessType || undefined) || (lead.businessType || '').trim() || lead.phone || 'Lead';
}

/** The CSV a super admin can download, fill in and upload. */
export const CRM_CSV_COLUMNS = ['name', 'phone', 'email', 'business', 'city', 'source', 'stage', 'tags', 'notes'] as const;
export const CRM_CSV_TEMPLATE =
  CRM_CSV_COLUMNS.join(',') + '\n' +
  'Asha Rao,+919876543210,asha@example.com,Asha Bakery,Pune,Referral,Qualifying,bakery;pune,Met at an expo\n' +
  'Ravi Kumar,9123456789,,Kumar Salon,Mumbai,Phone Call,Demo scheduled,,Asked for a demo next week\n';

export interface CrmImportRow {
  name: string;
  phone: string;
  email?: string;
  businessType?: string;
  city?: string;
  source: CrmSource;
  stage: CrmStage | null;
  tags: string[];
  notes?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One spreadsheet row → a lead to file, or why it can't be. Column names are matched loosely. */
export function normaliseCrmImportRow(raw: Record<string, unknown>): { ok: true; row: CrmImportRow } | { ok: false; error: string } {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const found = Object.keys(raw).find((r) => r.trim().toLowerCase() === k);
      if (found && raw[found] != null && String(raw[found]).trim() !== '') return String(raw[found]).trim();
    }
    return '';
  };
  const phoneRaw = get('phone', 'mobile', 'phone number', 'mobile number', 'whatsapp', 'contact');
  const phone = phoneRaw ? normalizePhoneE164(phoneRaw) : null;
  if (!phoneRaw) return { ok: false, error: 'phone is missing' };
  if (!phone) return { ok: false, error: `phone "${phoneRaw}" is not a valid number` };
  const business = get('business', 'business name', 'company', 'businesstype');
  const name = get('name', 'full name', 'contact name', 'lead name');
  if (!name && !business) return { ok: false, error: 'name or business is required' };
  const email = get('email', 'email address', 'e-mail');
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: `email "${email}" is not valid` };
  const stageText = get('stage', 'lead stage', 'status');
  const stage = stageText ? parseCrmStage(stageText) : null;
  if (stageText && !stage) return { ok: false, error: `stage "${stageText}" is not a CRM stage` };
  return {
    ok: true,
    row: {
      name: name || business,
      phone,
      email: email || undefined,
      businessType: business || undefined,
      city: get('city', 'location', 'area') || undefined,
      source: parseCrmSource(get('source', 'lead source'), 'CSV Import'),
      stage,
      tags: get('tags', 'tag').split(/[;,]/).map((t) => t.trim()).filter(Boolean).slice(0, 20),
      notes: get('notes', 'note', 'comments') || undefined,
    },
  };
}

/** One CSV field, quoted when needed. */
export function csvField(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Calls, follow-ups, custom sub-stages ───────────────────────────────────

export const CALL_OUTCOMES = [
  { value: 'connected', label: 'Connected' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'busy', label: 'Busy' },
  { value: 'callback', label: 'Asked to call back' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'voicemail', label: 'Left voicemail' },
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number]['value'];
export const callOutcomeLabel = (v: unknown) => CALL_OUTCOMES.find((o) => o.value === v)?.label ?? String(v ?? '');

export const FOLLOW_UP_TYPES = ['Call', 'WhatsApp', 'Email', 'Meeting', 'Other'] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

export const SUB_STAGE_COLORS = ['slate', 'blue', 'green', 'amber', 'red', 'purple'] as const;
export const MAX_SUB_STAGES = 40;

export interface CrmSubStage { id: string; name: string; stage: string; color: string }

/** Validates the team's sub-stage list; returns the cleaned list or why it can't be saved. */
export function validateSubStages(input: unknown): { ok: true; subStages: CrmSubStage[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'Sub-stages must be a list.' };
  if (input.length > MAX_SUB_STAGES) return { ok: false, error: `At most ${MAX_SUB_STAGES} sub-stages.` };
  const out: CrmSubStage[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const raw of input as any[]) {
    const name = String(raw?.name ?? '').trim();
    const stage = String(raw?.stage ?? '');
    if (!name) return { ok: false, error: 'Every sub-stage needs a name.' };
    if (name.length > 40) return { ok: false, error: `"${name.slice(0, 20)}…" is longer than 40 characters.` };
    const def = crmStageDef(stage);
    if (!def || !def.settable) return { ok: false, error: `"${name}" needs a main stage.` };
    const key = `${stage}:${name.toLowerCase()}`;
    if (names.has(key)) return { ok: false, error: `"${name}" appears twice under ${def.label}.` };
    names.add(key);
    let id = String(raw?.id ?? '').trim();
    if (!/^[a-z0-9_-]{1,40}$/i.test(id) || ids.has(id)) id = `ss_${Math.random().toString(36).slice(2, 10)}`;
    ids.add(id);
    const color = (SUB_STAGE_COLORS as readonly string[]).includes(raw?.color) ? raw.color : 'slate';
    out.push({ id, name, stage, color });
  }
  return { ok: true, subStages: out };
}
