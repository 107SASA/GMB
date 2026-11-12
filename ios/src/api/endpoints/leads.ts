import { z } from 'zod';
import { api, businessHeaders } from '../client';

/**
 * CRM leads — same /api/crm/leads endpoints the web CRM (list + Kanban)
 * uses. Stages are the canonical lifeCycleStage + sub-stage (stable id) from
 * /api/business/lead-stages — see endpoints/crm.ts.
 */

const leadSchema = z.object({
  _id: z.string(),
  name: z.string().catch('Unknown'),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  source: z.string().catch('Manual'),
  status: z.string().catch('active'),
  lifeCycleStage: z.string().catch('initial'),
  subStage: z.string().nullable().catch(null),
  subStageId: z.string().nullable().catch(null),
  // Legacy display only — older rows; stage writes use lifeCycleStage.
  pipelineStage: z.string().nullable().catch(null),
  deal: z
    .object({
      value: z.number().nullable().catch(null),
      currency: z.string().catch('INR'),
      closedAt: z.string().nullable().catch(null),
      notes: z.string().nullable().optional(),
      valueMissing: z.boolean().nullable().optional(),
    })
    .nullable()
    .catch(null),
  tags: z.array(z.string()).catch([]),
  notes: z.string().nullable().optional(),
  interest: z.string().nullable().optional(),
  // Manually entered estimated deal value (INR) — see models/Lead.ts.
  valuation: z.number().nullable().optional(),
  // Visiting-card details (source "Business Card"); absent on other leads.
  businessCard: z
    .object({
      company: z.string().optional(),
      designation: z.string().optional(),
      website: z.string().optional(),
      address: z.string().optional(),
      otherPhones: z.array(z.string()).optional(),
      otherEmails: z.array(z.string()).optional(),
      metAt: z.string().optional(),
      imageKeys: z.array(z.string()).optional(),
      // Saved automatically (no confirmation) and the AI was unsure → "Check details".
      needsReview: z.boolean().optional(),
    })
    .nullable()
    .optional()
    .catch(null),
  city: z.string().nullable().optional(),
  lastActivityAt: z.string().nullable().catch(null),
  createdAt: z.string().optional(),
});
export type Lead = z.infer<typeof leadSchema>;

const leadsResponseSchema = z.object({
  success: z.literal(true),
  leads: z.array(leadSchema.nullable().catch(null)),
});

/** GET /api/crm/leads — every lead for the active business, newest first. */
export async function fetchLeads(): Promise<Lead[]> {
  const { data } = await api.get('/api/crm/leads');
  return leadsResponseSchema.parse(data).leads.filter((l): l is Lead => l !== null);
}

/**
 * PATCH /api/crm/leads/[id] — notes / status / tags, and stage moves as
 * lifeCycleStage + subStageId. Moving to converted (Won) needs `deal`
 * (the server answers 422 DEAL_VALUE_REQUIRED otherwise). Every move writes
 * a status_change Activity server-side.
 */
export type DealInput = { value: number; currency: string; closedAt?: string; notes?: string };
export type LeadPatch = Partial<Pick<Lead, 'notes' | 'status' | 'tags' | 'lifeCycleStage'>> & {
  subStageId?: string | null;
  subStage?: string | null;
  deal?: DealInput;
  // "Edit lead" — contact + visiting-card details. The server refuses a phone /
  // email that belongs to another lead (409).
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  businessCard?: { company?: string; designation?: string; website?: string; address?: string; metAt?: string; needsReview?: boolean };
};

export async function updateLead(id: string, patch: LeadPatch): Promise<void> {
  await api.patch(`/api/crm/leads/${id}`, patch);
}

const timelineEntrySchema = z.object({
  _id: z.string(),
  timelineType: z.enum(['activity', 'followUp']).catch('activity'),
  date: z.string().nullable().catch(null),
  // Activity fields
  type: z.string().optional(),
  content: z.string().optional(),
  // FollowUp fields
  status: z.string().optional(),
  messageTemplate: z.string().optional(),
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

const timelineResponseSchema = z.object({
  success: z.literal(true),
  timeline: z.array(timelineEntrySchema.nullable().catch(null)),
});

/** GET /api/crm/leads/[id]/timeline — merged Activity + FollowUp history, newest first. */
export async function fetchLeadTimeline(id: string): Promise<TimelineEntry[]> {
  const { data } = await api.get(`/api/crm/leads/${id}/timeline`);
  return timelineResponseSchema
    .parse(data)
    .timeline.filter((t): t is TimelineEntry => t !== null);
}

const quickAddResponseSchema = z.object({
  success: z.literal(true),
  existing: z.boolean(),
  lead: leadSchema,
});
export type QuickAddResult = z.infer<typeof quickAddResponseSchema>;

/**
 * POST /api/leads/quick-add — create a lead from a phone number. The server
 * normalizes to E.164 and dedupes by phone within the business; an existing
 * match comes back with existing: true instead of a duplicate.
 */
export async function quickAddLead(params: {
  phone: string;
  name?: string;
  source?: 'Manual' | 'Phone Call' | 'Contacts Import';
  valuation?: number;
}): Promise<QuickAddResult> {
  const { data } = await api.post('/api/leads/quick-add', params);
  return quickAddResponseSchema.parse(data);
}

const bulkImportResponseSchema = z.object({
  success: z.literal(true),
  created: z.number(),
  skipped: z.number(),
});
export type BulkImportResult = z.infer<typeof bulkImportResponseSchema>;

/**
 * POST /api/leads/bulk-import — user-SELECTED contacts only (max 200).
 * Never send the full address book. Returns created/skipped (dupe) counts.
 */
export async function bulkImportLeads(
  leads: { name: string; phone: string; email?: string }[]
): Promise<BulkImportResult> {
  const { data } = await api.post('/api/leads/bulk-import', { leads });
  return bulkImportResponseSchema.parse(data);
}

/**
 * POST /api/crm/leads/[id]/activity — appends a timeline Activity (used by
 * Plan-A call logging: type "call").
 */
export async function logLeadActivity(
  leadId: string,
  entry: { type: 'call' | 'note' | 'WhatsApp' | 'email'; content: string }
): Promise<void> {
  await api.post(`/api/crm/leads/${leadId}/activity`, entry);
}


// ── Visiting card scan ───────────────────────────────────────────────────

const cardFieldsSchema = z.object({
  isBusinessCard: z.boolean().catch(true),
  name: z.string().catch(''),
  designation: z.string().catch(''),
  company: z.string().catch(''),
  phones: z.array(z.object({ number: z.string(), label: z.string().catch('other') })).catch([]),
  emails: z.array(z.string()).catch([]),
  website: z.string().catch(''),
  address: z.string().catch(''),
  city: z.string().catch(''),
  uncertain: z.array(z.string()).catch([]),
});
export type CardFields = z.infer<typeof cardFieldsSchema>;

const scanResponseSchema = z.object({
  success: z.literal(true),
  fields: cardFieldsSchema,
  imageKeys: z.array(z.string()).catch([]),
});
export type CardScanResult = z.infer<typeof scanResponseSchema>;

export type CardPhoto = { uri: string; mimeType: string; fileName: string };

/**
 * POST /api/leads/business-card/scan — the server reads the card with AI and
 * returns the form fields. Saves nothing; the owner reviews and submits.
 */
export async function scanBusinessCard(front: CardPhoto, back?: CardPhoto | null, opts: { signal?: AbortSignal } = {}): Promise<CardScanResult> {
  const form = new FormData();
  // React Native's FormData accepts this {uri,name,type} shape in place of a Blob.
  form.append('front', { uri: front.uri, name: front.fileName, type: front.mimeType } as unknown as Blob);
  if (back) form.append('back', { uri: back.uri, name: back.fileName, type: back.mimeType } as unknown as Blob);
  const { data } = await api.post('/api/leads/business-card/scan', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
    signal: opts.signal,
  });
  return scanResponseSchema.parse(data);
}

const autoSaveResponseSchema = z.object({
  success: z.literal(true),
  saved: z.literal(true),
  existing: z.boolean().catch(false),
  needsReview: z.boolean().catch(false),
  lead: leadSchema,
});
export type CardAutoSaveResult = z.infer<typeof autoSaveResponseSchema>;

/**
 * POST /api/leads/business-card/scan with autoSave=1 — read AND save in one
 * call (quick / offline capture, no confirmation). `clientId` is the phone's
 * id for this card: a retry after a dropped connection returns the same lead.
 */
export async function scanAndSaveCard(params: {
  clientId: string;
  businessId: string | null;
  front: CardPhoto;
  back: CardPhoto | null;
  metAt: string;
}): Promise<CardAutoSaveResult> {
  const form = new FormData();
  form.append('front', { uri: params.front.uri, name: params.front.fileName, type: params.front.mimeType } as unknown as Blob);
  if (params.back) form.append('back', { uri: params.back.uri, name: params.back.fileName, type: params.back.mimeType } as unknown as Blob);
  form.append('autoSave', '1');
  form.append('clientId', params.clientId);
  if (params.metAt) form.append('metAt', params.metAt);
  const { data } = await api.post('/api/leads/business-card/scan', form, {
    headers: {
      'Content-Type': 'multipart/form-data',
      // The workspace the card was captured in, even if the owner switched since.
      ...(params.businessId ? businessHeaders(params.businessId).headers : {}),
    },
    timeout: 60_000,
  });
  return autoSaveResponseSchema.parse(data);
}

export type BusinessCardLeadInput = {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  designation?: string;
  website?: string;
  address?: string;
  city?: string;
  metAt?: string;
  notes?: string;
  valuation?: number;
  otherPhones?: string[];
  otherEmails?: string[];
  imageKeys?: string[];
};

/** POST /api/leads/business-card — saves the reviewed card form (dedupes by phone/email). */
export async function saveBusinessCardLead(input: BusinessCardLeadInput, businessId?: string | null): Promise<QuickAddResult> {
  const { data } = await api.post('/api/leads/business-card', input, businessId ? businessHeaders(businessId) : undefined);
  return quickAddResponseSchema.parse(data);
}

const cardEventsSchema = z.object({
  success: z.literal(true),
  events: z
    .array(z.object({ name: z.string(), count: z.number().catch(0), lastUsedAt: z.string().nullable().catch(null) }))
    .catch([]),
});
export type CardEvent = z.infer<typeof cardEventsSchema>['events'][number];

/** GET /api/leads/business-card/events — "Where you met" values used in this workspace, newest first. */
export async function fetchCardEvents(): Promise<CardEvent[]> {
  const { data } = await api.get('/api/leads/business-card/events');
  return cardEventsSchema.parse(data).events;
}
