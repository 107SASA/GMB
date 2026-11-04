import { z } from 'zod';
import { api } from '../client';

/**
 * Plan tasks — the fixes from the latest connected audit, with live status.
 * Same routes as the web dashboard: GET /api/tasks, POST /api/tasks/[id]/done
 * ("I've done this"), POST /api/tasks/popup (hide the "fixes ready" sheet for
 * one report). Which screen fixes what comes from the server
 * (src/services/tasks/planTasks.ts) — `target.mobile` is an Expo Router path,
 * null when the fix happens outside the app.
 */

const statusSchema = z.enum(['open', 'waiting_approval', 'done', 'confirmed', 'reopened', 'blocked']);
export type TaskStatus = z.infer<typeof statusSchema>;

export const taskSchema = z.object({
  id: z.string(),
  findingId: z.string(),
  title: z.string().catch('Fix'),
  evidence: z.string().catch(''),
  priority: z.enum(['high', 'medium', 'low']).catch('medium'),
  status: statusSchema.catch('open'),
  statusReason: z.string().catch(''),
  actor: z.enum(['approve', 'automatic', 'owner']).catch('owner'),
  ownerAction: z.string().catch(''),
  growwmaticsAction: z.string().nullable().catch(null),
  target: z.object({
    screen: z.string().catch('instructions'),
    section: z.string().optional().catch(undefined),
    mobile: z.string().nullable().catch(null),
    label: z.string().catch('How to do this'),
  }),
  canMarkDone: z.boolean().catch(false),
  doneAt: z.string().nullable().catch(null),
  confirmedAt: z.string().nullable().catch(null),
});
export type PlanTask = z.infer<typeof taskSchema>;

const listSchema = z.object({
  tasks: z.array(taskSchema.nullable().catch(null)).catch([]),
  summary: z.object({ total: z.number(), completed: z.number(), open: z.number() }).catch({ total: 0, completed: 0, open: 0 }),
  report: z.object({ auditId: z.string(), createdAt: z.string() }).nullable().catch(null),
  showPopup: z.boolean().catch(false),
});

export interface TaskList {
  tasks: PlanTask[];
  summary: { total: number; completed: number; open: number };
  report: { auditId: string; createdAt: string } | null;
  showPopup: boolean;
}

/** GET /api/tasks — the active workspace's tasks, in the order to do them. */
export async function fetchTasks(): Promise<TaskList> {
  const { data } = await api.get('/api/tasks');
  const parsed = listSchema.parse(data);
  return { ...parsed, tasks: parsed.tasks.filter((t): t is PlanTask => t !== null) };
}

/** "I've done this" — only for work done outside GrowwMatics (the server refuses the rest). */
export async function markTaskDone(taskId: string): Promise<void> {
  await api.post(`/api/tasks/${encodeURIComponent(taskId)}/done`);
}

/** Closing or finishing the "fixes ready" sheet hides it for that report. */
export async function dismissTaskPopup(auditId: string): Promise<void> {
  await api.post('/api/tasks/popup', { auditId });
}

export const isOpenTask = (t: PlanTask) => t.status === 'open' || t.status === 'waiting_approval' || t.status === 'reopened';
