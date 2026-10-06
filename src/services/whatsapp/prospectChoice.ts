/**
 * Pure copy and routing for a WhatsApp prospect who does not already have
 * an active sales, booking, or support thread. No database and no Google calls.
 * The webhook and the demo agent apply these results; they do not replace
 * lead intelligence, NBA, or human-handoff rules.
 */

export type ProspectMode = 'new' | 'report-ready' | 'report-processing';
export type ProspectChoice = 'demo' | 'report' | 'view-report' | 'wait' | 'unknown';
export type IntakePhase = 'need-both' | 'need-name' | 'need-location';
export type ReportStatus = 'completed' | 'processing' | 'none';

export interface ProspectFacts {
  name: string;
  businessName: string;
  location: string;
  reportStatus: ReportStatus;
  auditId: string | null;
}

export const NEW_LEAD_MENU =
  'Hi! 👋 What would you like to do?\n\n' +
  '1️⃣ Book a Demo — Talk to our team and see how Growwmatics can help your business.\n\n' +
  '2️⃣ Get Free Google Business Profile Report — Get your free visibility and optimization report.\n\n' +
  'Reply 1 or 2.';

export const REPORT_READY_MENU =
  'Your free Google Business Profile report is already ready 📊\n\n' +
  'What would you like to do?\n\n' +
  '1️⃣ View Report\n' +
  '2️⃣ Book a Demo';

export const REPORT_PROCESSING_MESSAGE =
  'Your free report is currently being prepared. 📊\n\n' +
  'Would you like to wait for the report or book a demo with our team?';

export const REPORT_ASK_BOTH =
  "Sure! I'll generate your free Google Business Profile report. Please share your business name and location.";

export const REPORT_ASK_LOCATION = 'Great. I just need your business location.';

export const REPORT_ASK_NAME = 'Great. I just need your business name.';

export const DEMO_TIME_ASK =
  "Absolutely! What date and time would be convenient for you? I'll check our team's availability and book the demo.";

export const DEMO_TIME_CLARIFY =
  'What date and time works for you? For example, tomorrow at 11 AM.';

export const SCHEDULE_HANDOFF_ONCE =
  "Sure — I'll have a team member help schedule this with you. Our team will message you here shortly.";

const DEMO_RE = /\b(demo|book|schedule|walkthrough)\b/i;
const VIEW_RE = /\b(?:show|view|see)\b[\s\S]{0,40}\breport\b|\breport\b[\s\S]{0,40}\b(?:show|view|see)\b/i;
const REPORT_RE = /\b(report|google business|visibility)\b/i;

const REPORT_REUSE_MS = 30 * 24 * 60 * 60 * 1000;
const REPORT_PENDING_MS = 5 * 60 * 1000;

export function menuFor(mode: ProspectMode): string {
  if (mode === 'report-ready') return REPORT_READY_MENU;
  if (mode === 'report-processing') return REPORT_PROCESSING_MESSAGE;
  return NEW_LEAD_MENU;
}

function choiceNumber(text: string): '1' | '2' | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '1' || trimmed === '1️⃣' || /^option\s*1\b/.test(trimmed)) return '1';
  if (trimmed === '2' || trimmed === '2️⃣' || /^option\s*2\b/.test(trimmed)) return '2';
  return null;
}

/** Interprets 1/2 and natural language. The meaning of 1 and 2 depends on which menu this phone was shown. */
export function classifyProspectChoice(text: string, mode: ProspectMode): ProspectChoice {
  const raw = (text || '').trim();
  if (!raw) return 'unknown';
  const number = choiceNumber(raw);
  const wantsDemo = DEMO_RE.test(raw);
  const wantsView = VIEW_RE.test(raw);
  const wantsReport = REPORT_RE.test(raw);

  if (mode === 'report-processing') {
    if (number === '2' || wantsDemo) return 'demo';
    return 'wait';
  }

  if (mode === 'report-ready') {
    if (number === '2' || (wantsDemo && !wantsView)) return 'demo';
    if (number === '1' || wantsView || wantsReport) return 'view-report';
    return 'unknown';
  }

  if (number === '1' || (wantsDemo && !wantsReport)) return 'demo';
  if (number === '2' || wantsReport || wantsView) return 'report';
  return 'unknown';
}

export function reportIntakeQuestion(facts: { businessName?: string; location?: string }): { phase: IntakePhase; text: string } | null {
  const businessName = (facts.businessName || '').trim();
  const location = (facts.location || '').trim();
  if (businessName && location) return null;
  if (!businessName && !location) return { phase: 'need-both', text: REPORT_ASK_BOTH };
  if (!businessName) return { phase: 'need-name', text: REPORT_ASK_NAME };
  return { phase: 'need-location', text: REPORT_ASK_LOCATION };
}

export function applyReportIntake(
  phase: IntakePhase,
  text: string,
  known: { businessName?: string; location?: string }
): { businessName: string; location: string; question: { phase: IntakePhase; text: string } | null } {
  let businessName = (known.businessName || '').trim();
  let location = (known.location || '').trim();
  const raw = (text || '').trim();
  if (phase === 'need-name') businessName = raw;
  else if (phase === 'need-location') location = raw;
  else {
    const parts = raw.split(/\s*(?:,|\/)\s*|\s+\bin\b\s+/i).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      businessName = parts[0];
      location = parts.slice(1).join(', ');
    } else if (raw) businessName = raw;
  }
  return { businessName, location, question: reportIntakeQuestion({ businessName, location }) };
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function usefulName(value: unknown): string {
  const name = clean(value);
  if (!name || name.toLowerCase() === 'new user') return '';
  if (/^\+?\d[\d\s-]{7,}$/.test(name)) return '';
  return name;
}

export function factsFromStored(input: {
  now?: Date;
  lead?: { name?: string; businessType?: string; auditId?: unknown } | null;
  audit?: { _id?: unknown; status?: string; businessName?: string; city?: string; location?: string; address?: string; createdAt?: Date | string } | null;
  sales?: { leadName?: string; scores?: { businessName?: string }; auditId?: unknown } | null;
}): ProspectFacts {
  const now = input.now || new Date();
  const audit = input.audit;
  const businessName = clean(audit?.businessName) || clean(input.sales?.scores?.businessName) || clean(input.lead?.businessType);
  const location = clean(audit?.city) || clean(audit?.location) || clean(audit?.address);
  const name = usefulName(input.lead?.name) || usefulName(input.sales?.leadName);
  let reportStatus: ReportStatus = 'none';
  const created = audit?.createdAt ? new Date(audit.createdAt).getTime() : 0;
  const age = created ? now.getTime() - created : Number.POSITIVE_INFINITY;
  if (audit?.status === 'COMPLETED' && age <= REPORT_REUSE_MS) reportStatus = 'completed';
  else if (audit?.status === 'PENDING' && age <= REPORT_PENDING_MS) reportStatus = 'processing';
  const auditId = audit?._id ? String(audit._id) : input.lead?.auditId ? String(input.lead.auditId) : input.sales?.auditId ? String(input.sales.auditId) : null;
  return { name, businessName, location, reportStatus, auditId: reportStatus === 'none' ? auditId : auditId };
}

export function modeFor(status: ReportStatus): ProspectMode {
  if (status === 'completed') return 'report-ready';
  if (status === 'processing') return 'report-processing';
  return 'new';
}

export function slotAvailableCopy(timeLabel: string): string {
  return `${timeLabel} is available. Shall I book it?`;
}

export function alternativesCopy(requestedLabel: string, options: string[]): string {
  const marks = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  const lines = options.map((option, index) => `${marks[index] || `${index + 1}.`} ${option}`);
  return `I don't have ${requestedLabel} available, but I can offer:\n\n${lines.join('\n')}\n\nWhich works best for you?`;
}

export function confirmsSingleSlot(text: string): boolean {
  const normalized = (text || '').trim().toLowerCase().replace(/[.!]+$/, '');
  return ['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay', 'book it', 'confirm', 'please book'].includes(normalized);
}

/** After the one scheduling handoff, or once a human owns the lead, the demo agent must stay quiet. */
export function schedulingReplyAllowed(input: { humanOwned: boolean; handoffAlreadySent: boolean }): boolean {
  return !input.humanOwned && !input.handoffAlreadySent;
}
