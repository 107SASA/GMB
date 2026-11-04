/**
 * Report "Fix these issues" list and its buttons: each open task links to the
 * screen that fixes it, done/confirmed show their date, work outside
 * GrowwMatics shows steps instead of a link.
 * Run: npx tsx --test tests/render/plan-tasks.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskView, sortTasks } from '../../src/services/tasks/planTasks';

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/plan-tasks-render';

async function render(el: (React: any, m: any) => any) {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime' as string);
  const m = await import('../../src/components/tasks/PlanTasks');
  const noop = () => {};
  const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, hmrRefresh: noop };
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, el(React, m)));
}

const task = (id: string, findingId: string, capability: string | null, status: any, extra: any = {}, pending: string[] = []) =>
  buildTaskView({ _id: id, findingId, capability, status, description: id, ownerAction: `owner steps for ${id}`, ...extra }, new Set(pending));

const mulsetu = sortTasks([
  task('Add your 6 services', 'website.services.missing_on_gbp', 'update_services', 'READY'),
  task('Set attributes', 'gbp.attributes.none', 'update_attributes', 'READY', {}, ['attribute']),
  task('Add website pages', 'website.gbp_services_not_on_site', null, 'PLANNED'),
  task('Opening hours', 'profile.business_hours.missing', 'update_hours', 'EXECUTED', { executedAt: '2026-11-05T09:00:00.000Z' }),
  task('Google updates', 'gbp.change.description', null, 'VERIFIED', { verifiedAt: '2026-11-28T09:00:00.000Z' }),
]);

test('report fix list: progress, live status, and the right button for each task', async () => {
  const html = await render((React, m) => React.createElement(m.ReportFixList, { tasks: mulsetu, onMarkDone: async () => null }));
  assert.match(html, /Fix these issues/);
  assert.match(html, /2 of 5 done/);
  assert.match(html, /Fix them step by step/);
  assert.match(html, /href="\/dashboard\/profile-optimization\?section=services"[^>]*>Fix now/);
  assert.match(html, /href="\/dashboard\/profile-optimization\?section=attributes"[^>]*>Approve now/, 'a drafted change is approved, not redone');
  assert.match(html, /Waiting for approval/);
  assert.match(html, />How to do this</, 'website work has steps, not a link');
  assert.match(html, /Done on/);
  assert.match(html, /Confirmed on/);
  assert.ok(!/href="null"/.test(html));
});

test('report fix list: nothing rendered without tasks (free report)', async () => {
  const html = await render((React, m) => React.createElement(m.ReportFixList, { tasks: [], onMarkDone: async () => null }));
  assert.equal(html, '');
});

test('all done: no "step by step" button', async () => {
  const html = await render((React, m) => React.createElement(m.ReportFixList, { tasks: mulsetu.filter((t) => t.status === 'done' || t.status === 'confirmed'), onMarkDone: async () => null }));
  assert.match(html, /2 of 2 done/);
  assert.ok(!/Fix them step by step/.test(html));
});

test('reopened task shows "Found again" and a Fix now link', async () => {
  const html = await render((React, m) => React.createElement(m.TaskRow, { task: task('Services again', 'website.services.missing_on_gbp', 'update_services', 'PLANNED', { reopenedAt: '2026-11-28T09:00:00.000Z' }) }));
  assert.match(html, /Found again/);
  assert.match(html, /Found again in the latest report/);
  assert.match(html, />Fix now/);
});
