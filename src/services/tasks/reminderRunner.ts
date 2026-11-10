import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import Business from '@/models/Business';
import { PLAN_ACCESS_FIELDS, workspaceHasPlanAccess } from '@/lib/billing/entitlements';
import { appLink, composeOwnerMessage } from '@/lib/whatsappOutbound';
import { notifyBusinessUsers } from '@/services/notifications';
import { notifyOwner } from '@/services/ownerNotify';
import { sendPushToBusinessUsers } from '@/services/push';
import { getTaskList } from './taskService';
import { channelOf, dueReminderStep, reminderContent, REMINDER_WINDOW_DAYS, type ReminderStep } from './reminders';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReminderOutcome =
  | { status: 'sent'; step: ReminderStep; channel: string }
  | { status: 'skipped'; reason: string; step?: ReminderStep };

/**
 * Claims a step for this report atomically (a concurrent run cannot send it
 * twice). A new report resets the claimed steps.
 */
async function claimStep(businessId: string, auditId: string, step: ReminderStep): Promise<boolean> {
  await Business.updateOne(
    { _id: businessId, taskReminderAuditId: { $ne: auditId } },
    { $set: { taskReminderAuditId: auditId, taskRemindersSent: [] } },
  );
  const claimed = await Business.findOneAndUpdate(
    { _id: businessId, taskReminderAuditId: auditId, taskRemindersSent: { $ne: step } },
    { $addToSet: { taskRemindersSent: step } },
    { new: true, projection: { _id: 1 } },
  ).lean();
  return !!claimed;
}

/** Sends this business's due reminder for its latest connected report, if any. */
export async function runTaskReminder(businessId: string, now = new Date()): Promise<ReminderOutcome> {
  await dbConnect();
  const business: any = await Business.findById(businessId)
    .select(`name isDeleted taskReminderAuditId taskRemindersSent ${PLAN_ACCESS_FIELDS} googleConnected googleAccess`)
    .lean();
  if (!business || business.isDeleted) return { status: 'skipped', reason: 'no_business' };
  if (!workspaceHasPlanAccess(business, now)) return { status: 'skipped', reason: 'no_plan_access' };
  // No "fix these tasks" nudges while Google refuses access — the dashboard
  // shows the access problem instead (lib/googleAccess.ts).
  const { hasGoogleAccess } = await import('@/lib/googleAccess');
  if (!hasGoogleAccess(business)) return { status: 'skipped', reason: 'no_google_access' };

  const report: any = await Audit.findOne({ businessId, status: 'COMPLETED', auditKind: { $in: ['connected_baseline', 'monthly'] } })
    .sort({ createdAt: -1 }).select('_id createdAt').lean();
  if (!report) return { status: 'skipped', reason: 'no_report' };
  const auditId = String(report._id);
  const sent: string[] = business.taskReminderAuditId === auditId ? business.taskRemindersSent || [] : [];
  const step = dueReminderStep(new Date(report.createdAt), now, sent);
  if (!step) return { status: 'skipped', reason: 'nothing_due' };

  const list = await getTaskList(businessId);
  const content = reminderContent(list.tasks, step);
  if (!content) return { status: 'skipped', reason: 'all_done', step };
  if (!(await claimStep(businessId, auditId, step))) return { status: 'skipped', reason: 'already_claimed', step };

  const channel = channelOf(step);
  const webPath = content.task.target.web || '/dashboard';
  if (channel === 'inapp') {
    await notifyBusinessUsers(businessId, { type: 'plan_task_reminder', title: content.title, body: content.detail, link: '/dashboard' });
  } else if (channel === 'push') {
    await sendPushToBusinessUsers(businessId, {
      title: content.title,
      body: `${content.headline}.${content.detail ? ` ${content.detail}` : ''}`,
      data: { taskPath: content.task.target.mobile || '/dashboard' },
    });
  } else {
    const res = await notifyOwner(businessId, {
      event: 'plan_task_reminder',
      text: composeOwnerMessage({
        name: business.name || 'your business',
        body: `${content.headline}.${content.detail ? ` ${content.detail}` : ''}`,
        linkLabel: 'Fix it now',
        link: appLink(webPath),
        noLinkText: 'Open your checklist in the GrowwMatics dashboard.',
      }),
    });
    // Claimed either way: an opted-out owner or a failed send is not retried daily.
    if (res.status !== 'sent') return { status: 'skipped', reason: `whatsapp_${res.status}${'reason' in res && res.reason ? `_${res.reason}` : ''}`, step };
  }
  return { status: 'sent', step, channel };
}

/** Daily: every business with a connected report from the last REMINDER_WINDOW_DAYS days. */
export async function runTaskRemindersAll(now = new Date()): Promise<{ businesses: number; sent: number; byStep: Record<string, number> }> {
  await dbConnect();
  const since = new Date(now.getTime() - (REMINDER_WINDOW_DAYS + 1) * DAY_MS);
  const ids: unknown[] = await Audit.distinct('businessId', {
    status: 'COMPLETED',
    auditKind: { $in: ['connected_baseline', 'monthly'] },
    createdAt: { $gte: since, $lte: now },
  });
  const byStep: Record<string, number> = {};
  let sent = 0;
  for (const id of ids) {
    try {
      const r = await runTaskReminder(String(id), now);
      if (r.status === 'sent') {
        sent++;
        byStep[r.step] = (byStep[r.step] || 0) + 1;
      }
    } catch (err: any) {
      console.error(`[task-reminders] business ${String(id)} failed:`, err?.message);
    }
  }
  return { businesses: ids.length, sent, byStep };
}
