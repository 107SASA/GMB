import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import OptimizationAction from '@/models/OptimizationAction';
import GbpProfileChange from '@/models/GbpProfileChange';
import Audit from '@/models/Audit';
import Business from '@/models/Business';
import {
  buildTaskView,
  canMarkDone,
  isCustomerTask,
  PENDING_CHANGE_STATUSES,
  shouldShowTaskPopup,
  sortTasks,
  summarizeTasks,
  type TaskSummary,
  type TaskView,
} from './planTasks';

export interface TaskList {
  tasks: TaskView[];
  summary: TaskSummary;
  /** The latest connected report the tasks come from (null before the first one). */
  report: { auditId: string; createdAt: string } | null;
  /** Show the "fixes ready" popup for this report. */
  showPopup: boolean;
}

/** Every plan task for the workspace, in the order the customer should do them. */
export async function getTaskList(businessId: string): Promise<TaskList> {
  await dbConnect();
  const [actions, pending, latest, business] = await Promise.all([
    OptimizationAction.find({ businessId }).lean(),
    GbpProfileChange.find({ businessId, status: { $in: [...PENDING_CHANGE_STATUSES] } }).select('kind').lean(),
    Audit.findOne({ businessId, status: 'COMPLETED', auditKind: { $in: ['connected_baseline', 'monthly'] } })
      .sort({ createdAt: -1 }).select('_id createdAt').lean(),
    Business.findById(businessId).select('taskPopupDismissedAuditId').lean(),
  ]);
  const pendingKinds = new Set((pending as any[]).map((c) => String(c.kind)));
  const tasks = sortTasks((actions as any[]).filter(isCustomerTask).map((a) => buildTaskView(a, pendingKinds)));
  const summary = summarizeTasks(tasks);
  const latestId = latest ? String((latest as any)._id) : null;
  return {
    tasks,
    summary,
    report: latest ? { auditId: latestId!, createdAt: new Date((latest as any).createdAt).toISOString() } : null,
    showPopup: shouldShowTaskPopup(summary, latestId, (business as any)?.taskPopupDismissedAuditId),
  };
}

/**
 * "I've done this" for work outside GrowwMatics (website changes and the
 * like). Anything GrowwMatics can detect itself is refused. The next audit
 * confirms it — or reopens it if the issue is still there.
 */
export async function markTaskDone(businessId: string, taskId: string, userId: string): Promise<{ ok: true; task: TaskView } | { ok: false; status: number; error: string }> {
  if (!mongoose.isValidObjectId(taskId)) return { ok: false, status: 404, error: 'Task not found.' };
  await dbConnect();
  const action: any = await OptimizationAction.findOne({ _id: taskId, businessId }).lean();
  if (!action || !isCustomerTask(action)) return { ok: false, status: 404, error: 'Task not found.' };
  if (!canMarkDone(action)) {
    return { ok: false, status: 409, error: 'This one updates on its own once the change is on Google.' };
  }
  const now = new Date();
  const updated: any = await OptimizationAction.findOneAndUpdate(
    { _id: taskId, businessId, status: { $ne: 'VERIFIED' }, ownerMarkedDoneAt: null },
    {
      $set: { ownerMarkedDoneAt: now, reopenedAt: null },
      $push: { history: { at: now, status: action.status, reason: `Marked done by the owner (${userId})` } },
    },
    { new: true },
  ).lean();
  // Already done (or confirmed) — idempotent, return the current state.
  const doc = updated ?? (await OptimizationAction.findOne({ _id: taskId, businessId }).lean());
  return { ok: true, task: buildTaskView(doc as any, new Set()) };
}

/** Closing or finishing the popup hides it for that report only. */
export async function dismissTaskPopup(businessId: string, auditId: string): Promise<{ ok: boolean }> {
  if (!mongoose.isValidObjectId(auditId)) return { ok: false };
  await dbConnect();
  const audit = await Audit.exists({ _id: auditId, businessId });
  if (!audit) return { ok: false };
  await Business.updateOne({ _id: businessId }, { $set: { taskPopupDismissedAuditId: auditId } });
  return { ok: true };
}
