/**
 * Plan-task reminders: which step is due, never a late burst, and one plain
 * sentence naming the fix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelOf, dueReminderStep, reminderContent, REMINDER_SCHEDULE, tasksNeedingOwner } from '../../src/services/tasks/reminders.ts';
import { buildTaskView } from '../../src/services/tasks/planTasks.ts';

const DAY = 24 * 60 * 60 * 1000;
const report = new Date('2026-11-01T06:00:00Z');
const at = (days: number) => new Date(report.getTime() + days * DAY);

test('schedule: in-app day 0, push day 1 and 5, WhatsApp day 3 and 7', () => {
  assert.deepEqual(REMINDER_SCHEDULE.map((s) => [s.day, s.channel]), [[0, 'inapp'], [1, 'push'], [3, 'whatsapp'], [5, 'push'], [7, 'whatsapp']]);
  assert.equal(REMINDER_SCHEDULE.filter((s) => s.channel === 'whatsapp').length, 2, 'two WhatsApp reminders per report');
  assert.equal(channelOf('whatsapp_3'), 'whatsapp');
});

test('a daily run sends each step once, in order', () => {
  const sent: string[] = [];
  const log: string[] = [];
  for (let d = 0; d <= 12; d++) {
    const step = dueReminderStep(report, at(d + 0.2), sent);
    if (step) {
      sent.push(step);
      log.push(`${d}:${step}`);
    }
  }
  assert.deepEqual(log, ['0:inapp_0', '1:push_1', '3:whatsapp_3', '5:push_5', '7:whatsapp_7']);
});

test('late start: only the latest due step, earlier ones skipped — never a burst', () => {
  assert.equal(dueReminderStep(report, at(3.5), []), 'whatsapp_3');
  assert.equal(dueReminderStep(report, at(4), ['whatsapp_3']), null, 'nothing new on day 4');
  assert.equal(dueReminderStep(report, at(6), ['inapp_0']), 'push_5');
  assert.equal(dueReminderStep(report, at(6), ['push_5']), null);
});

test('no reminders before the report or after the window', () => {
  assert.equal(dueReminderStep(report, at(-1), []), null);
  assert.equal(dueReminderStep(report, at(11), []), null);
  assert.equal(dueReminderStep(report, at(8), ['whatsapp_7']), null, 'stops after the last WhatsApp');
});

const task = (id: string, capability: string | null, status: any, extra: any = {}, pending: string[] = []) =>
  buildTaskView({ _id: id, findingId: id, capability, status, description: `Task ${id}`, ...extra }, new Set(pending));

test('content names the top fix in plain words; how many more are waiting', () => {
  const tasks = [
    task('services', 'update_services', 'READY'),
    task('website', null, 'PLANNED'),
    task('posts', 'google_posts', 'READY'),
  ];
  const c = reminderContent(tasks, 'whatsapp_3')!;
  assert.equal(c.task.id, 'services');
  assert.equal(c.headline, 'Your services aren’t on your Google profile yet');
  assert.equal(c.detail, 'It takes about a minute to approve. 1 more fix is waiting too.', 'GrowwMatics’ own posts are not counted');
  assert.equal(reminderContent(tasks, 'whatsapp_7')!.title, 'Last reminder');
});

test('a drafted change says it is waiting for approval', () => {
  const c = reminderContent([task('a', 'update_attributes', 'READY', {}, ['attribute'])], 'push_1')!;
  assert.match(c.headline, /attributes aren’t set yet — it’s drafted and waiting for your approval/);
  assert.equal(c.detail, 'It takes about a minute to approve.');
});

test('day 0 in-app: how many fixes and how many are one-tap approvals', () => {
  const c = reminderContent([task('s', 'update_services', 'READY'), task('h', 'update_hours', 'READY'), task('w', null, 'PLANNED')], 'inapp_0')!;
  assert.equal(c.title, 'Your report found 3 things to fix');
  assert.match(c.detail, /^2 are ready/);
});

test('nothing to send when every owner fix is done (GrowwMatics work alone never triggers one)', () => {
  const tasks = [task('s', 'update_services', 'EXECUTED'), task('h', 'update_hours', 'VERIFIED'), task('p', 'google_posts', 'READY')];
  assert.equal(tasksNeedingOwner(tasks).length, 0);
  assert.equal(reminderContent(tasks, 'whatsapp_3'), null);
});
