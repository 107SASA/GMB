/**
 * Plan-task reminders (pure — runs under `node --test`). After each connected
 * report the owner is reminded of the fixes still waiting for them, one
 * channel per step, until every one is done:
 *
 *   day 0  in-app      "Your report found N things to fix"
 *   day 1  push        names the top fix, opens its screen
 *   day 3  WhatsApp    names one fix, with a link
 *   day 5  push
 *   day 7  WhatsApp    last one — then nothing more for this report
 *
 * At most one step per business per run (the job runs daily). A step that
 * became due while the job was not running is skipped, never sent late in a
 * burst: only the latest due step is sent. Nothing is sent once no fix needs
 * the owner (GrowwMatics' own work — posts, replies — never triggers one).
 */

import { isOpenStatus, type TaskView } from './planTasks.ts';

export type ReminderStep = 'inapp_0' | 'push_1' | 'whatsapp_3' | 'push_5' | 'whatsapp_7';
export type ReminderChannel = 'inapp' | 'push' | 'whatsapp';

export const REMINDER_SCHEDULE: Array<{ step: ReminderStep; day: number; channel: ReminderChannel }> = [
  { step: 'inapp_0', day: 0, channel: 'inapp' },
  { step: 'push_1', day: 1, channel: 'push' },
  { step: 'whatsapp_3', day: 3, channel: 'whatsapp' },
  { step: 'push_5', day: 5, channel: 'push' },
  { step: 'whatsapp_7', day: 7, channel: 'whatsapp' },
];

/** No reminder for a report older than this. */
export const REMINDER_WINDOW_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The step to send now: the latest one already due, unless it (or a later
 * one) was sent. Earlier unsent steps are skipped.
 */
export function dueReminderStep(reportAt: Date, now: Date, sent: readonly string[]): ReminderStep | null {
  const days = (now.getTime() - reportAt.getTime()) / DAY_MS;
  if (days < 0 || days > REMINDER_WINDOW_DAYS) return null;
  const due = REMINDER_SCHEDULE.filter((s) => s.day <= days);
  const latest = due[due.length - 1];
  if (!latest) return null;
  const latestIndex = REMINDER_SCHEDULE.indexOf(latest);
  const laterOrSameSent = REMINDER_SCHEDULE.slice(latestIndex).some((s) => sent.includes(s.step));
  return laterOrSameSent ? null : latest.step;
}

export function channelOf(step: ReminderStep): ReminderChannel {
  return REMINDER_SCHEDULE.find((s) => s.step === step)!.channel;
}

/** Fixes that need the owner: open, and not something GrowwMatics runs itself. */
export function tasksNeedingOwner(tasks: TaskView[]): TaskView[] {
  return tasks.filter((t) => isOpenStatus(t.status) && t.actor !== 'automatic');
}

const HEADLINE: Record<string, string> = {
  services: 'Your services aren’t on your Google profile yet',
  categories: 'Your Google categories aren’t set yet',
  attributes: 'Your Google attributes aren’t set yet',
  links: 'Your booking link isn’t on Google yet',
  hours: 'Your opening hours aren’t on Google yet',
  description: 'A better Google description is ready for you',
  'service-area': 'Your service area isn’t set on Google yet',
  details: 'Your Google profile details need a fix',
  photos: 'Your Google profile needs real photos',
};

export interface ReminderContent {
  task: TaskView;
  /** One line naming the fix. */
  headline: string;
  /** The rest of the message: how long it takes, how many more are waiting. */
  detail: string;
  /** In-app / push title. */
  title: string;
}

export function reminderContent(tasks: TaskView[], step: ReminderStep): ReminderContent | null {
  const open = tasksNeedingOwner(tasks);
  if (!open.length) return null;
  const task = open[0];
  const more = open.length - 1;
  const moreText = more > 0 ? ` ${more} more fix${more === 1 ? ' is' : 'es are'} waiting too.` : '';

  if (step === 'inapp_0') {
    const approvals = open.filter((t) => t.actor === 'approve').length;
    return {
      task,
      title: `Your report found ${open.length} thing${open.length === 1 ? '' : 's'} to fix`,
      headline: `Your report found ${open.length} thing${open.length === 1 ? '' : 's'} to fix`,
      detail: approvals > 0
        ? `${approvals} ${approvals === 1 ? 'is' : 'are'} ready — you just approve and we update Google.`
        : 'Open your checklist to see what to do.',
    };
  }

  const known = task.target.section ? HEADLINE[task.target.section] : undefined;
  const headline = task.status === 'waiting_approval' && known
    ? `${known} — it’s drafted and waiting for your approval`
    : task.status === 'reopened'
      ? `This came back in your latest report: ${task.title}`
      : known || `${open.length} fix${open.length === 1 ? '' : 'es'} from your report ${open.length === 1 ? 'is' : 'are'} still open`;
  const action = task.actor === 'approve' ? ' It takes about a minute to approve.' : '';
  return { task, headline, detail: `${action}${moreText}`.trim(), title: step === 'whatsapp_7' ? 'Last reminder' : 'A fix is waiting' };
}
