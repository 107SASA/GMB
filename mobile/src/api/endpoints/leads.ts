import { z } from 'zod';
import { api } from '../client';

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
  entry: { type: 'call' | 'note'; content: string }
): Promise<void> {
  await api.post(`/api/crm/leads/${leadId}/activity`, entry);
}

