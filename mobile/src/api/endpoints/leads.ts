import { z } from 'zod';
import { api } from '../client';

/**
 * CRM leads — same /api/crm/leads endpoints the web CRM (list + Kanban)
 * uses. Pipeline stages are the business's custom Kanban columns, not a
 * fixed enum.
 */

const leadSchema = z.object({
  _id: z.string(),
  name: z.string().catch('Unknown'),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  source: z.string().catch('Manual'),
  status: z.string().catch('active'),
  lifeCycleStage: z.string().catch('initial'),
  pipelineStage: z.string().nullable().catch(null),
  tags: z.array(z.string()).catch([]),
  notes: z.string().nullable().optional(),
  aiLeadScore: z.number().nullable().optional(),
  aiInsights: z.string().nullable().optional(),
  interest: z.string().nullable().optional(),
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
 * PATCH /api/crm/leads/[id] — accepts pipelineStage / notes / status /
 * tags / lifeCycleStage. A pipelineStage change also writes a
 * status_change Activity server-side.
 */
export type LeadPatch = Partial<
  Pick<Lead, 'pipelineStage' | 'notes' | 'status' | 'tags' | 'lifeCycleStage'>
>;

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

const kanbanColumnsSchema = z.object({
  success: z.literal(true),
  kanbanColumns: z.array(z.string()).catch([]),
});

/** GET /api/business/kanban-columns — the business's pipeline stage names. */
export async function fetchKanbanColumns(): Promise<string[]> {
  const { data } = await api.get('/api/business/kanban-columns');
  return kanbanColumnsSchema.parse(data).kanbanColumns;
}
