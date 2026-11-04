/**
 * Plan tasks — the one finding → screen table shared by web, Android and iOS,
 * the customer-facing status, and the "seen fixed on Google" check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskView,
  canMarkDone,
  fixTargetFor,
  isCustomerTask,
  seenFixedOnGoogle,
  shouldShowTaskPopup,
  sortTasks,
  summarizeTasks,
  taskActor,
  taskDisplayStatus,
  type SnapshotForCheck,
} from '../../src/services/tasks/planTasks.ts';
import { GROWWMATICS_CAPABILITIES } from '../../src/services/audit/findings.ts';

test('every GrowwMatics capability except measurement opens a screen on web and mobile', () => {
  for (const cap of Object.keys(GROWWMATICS_CAPABILITIES)) {
    if (cap === 'rank_tracking') continue;
    const t = fixTargetFor('x', cap);
    assert.notEqual(t.screen, 'instructions', cap);
    assert.ok(t.web?.startsWith('/dashboard/'), `${cap} web path`);
    assert.ok(t.mobile?.startsWith('/'), `${cap} mobile path`);
  }
});

test('Mulsetu findings open the right Profile optimization section', () => {
  assert.equal(fixTargetFor('website.services.missing_on_gbp', 'update_services').web, '/dashboard/profile-optimization?section=services');
  assert.equal(fixTargetFor('website.services.missing_on_gbp', 'update_services').mobile, '/profile-optimization?section=services');
  assert.equal(fixTargetFor('gbp.attributes.none', 'update_attributes').section, 'attributes');
  assert.equal(fixTargetFor('website.booking.missing_on_gbp', 'update_booking_link').section, 'links');
  assert.equal(fixTargetFor('gbp.change.description', null).section, 'google-updates');
  assert.equal(fixTargetFor('gbp.change.description', null).mobile, null, 'the apps show steps — no Google-updates screen there');
  assert.equal(fixTargetFor('gbp.health.google_updates', null).screen, 'google-profile');
  // Website work happens outside GrowwMatics.
  const site = fixTargetFor('website.gbp_services_not_on_site', null);
  assert.equal(site.screen, 'instructions');
  assert.equal(site.web, null);
});

test('who acts: approve, automatic, owner', () => {
  assert.equal(taskActor('update_services'), 'approve');
  assert.equal(taskActor('update_description'), 'approve');
  assert.equal(taskActor('google_posts'), 'automatic');
  assert.equal(taskActor('review_replies'), 'automatic');
  assert.equal(taskActor('photo_uploads'), 'owner');
  assert.equal(taskActor('review_requests'), 'owner');
  assert.equal(taskActor(null), 'owner');
});

test('measurement and data coverage are never customer tasks', () => {
  assert.equal(isCustomerTask({ findingId: 'competitors.ahead', capability: 'rank_tracking' }), false);
  assert.equal(isCustomerTask({ findingId: 'data_quality.ranking_unavailable', capability: null }), false);
  assert.equal(isCustomerTask({ findingId: 'gbp.attributes.none', capability: 'update_attributes' }), true);
});

test('display status: open → waiting approval → done → confirmed; reopened; blocked', () => {
  const a = { findingId: 'f', capability: 'update_services', status: 'READY' as const };
  assert.equal(taskDisplayStatus(a, new Set()), 'open');
  assert.equal(taskDisplayStatus(a, new Set(['services'])), 'waiting_approval');
  assert.equal(taskDisplayStatus(a, new Set(['hours'])), 'open', 'a draft for another field is not this task');
  assert.equal(taskDisplayStatus({ ...a, status: 'EXECUTED' }, new Set(['services'])), 'done');
  assert.equal(taskDisplayStatus({ ...a, seenFixedOnGoogleAt: new Date() }, new Set()), 'done');
  assert.equal(taskDisplayStatus({ ...a, status: 'VERIFIED' }, new Set()), 'confirmed');
  assert.equal(taskDisplayStatus({ ...a, reopenedAt: new Date() }, new Set()), 'reopened');
  assert.equal(taskDisplayStatus({ ...a, reopenedAt: new Date(), status: 'EXECUTED' }, new Set()), 'done', 'done again after reopening');
  assert.equal(taskDisplayStatus({ ...a, status: 'BLOCKED' }, new Set()), 'blocked');
  assert.equal(taskDisplayStatus({ findingId: 'w', capability: null, status: 'PLANNED', ownerMarkedDoneAt: new Date() }, new Set()), 'done');
});

test('"I\'ve done this" only for work outside GrowwMatics', () => {
  assert.equal(canMarkDone({ findingId: 'website.gbp_services_not_on_site', capability: null }), true);
  assert.equal(canMarkDone({ findingId: 'website.services.missing_on_gbp', capability: 'update_services' }), false);
  assert.equal(canMarkDone({ findingId: 'gbp.change.title', capability: null }), false, 'detected from Google');
});

const snap = (loc: any, attrs: any = [], ok = true): SnapshotForCheck => ({
  sections: {
    location: { meta: { status: ok ? 'SUCCESS' : 'FAILED' }, data: loc },
    attributes: { meta: { status: ok ? 'SUCCESS' : 'FAILED' }, data: attrs },
  },
});
const loc = (over: any = {}) => ({
  primaryCategory: { name: 'gcid:software_company' }, description: 'x', primaryPhone: '+91', websiteUri: 'https://x',
  regularHours: [{}], services: [], metadata: { hasGoogleUpdated: false }, ...over,
});

test('seen fixed on Google: read from the live snapshot, unknown when unreadable', () => {
  assert.equal(seenFixedOnGoogle('website.services.missing_on_gbp', 'update_services', snap(loc())), false);
  assert.equal(seenFixedOnGoogle('website.services.missing_on_gbp', 'update_services', snap(loc({ services: [{ label: 'Web' }] }))), true);
  assert.equal(seenFixedOnGoogle('profile.business_hours.missing', 'update_hours', snap(loc({ regularHours: null }))), false);
  assert.equal(seenFixedOnGoogle('gbp.attributes.none', 'update_attributes', snap(loc(), [{ name: 'attributes/url_appointment' }])), false, 'a link is not an attribute fix');
  assert.equal(seenFixedOnGoogle('gbp.attributes.none', 'update_attributes', snap(loc(), [{ name: 'attributes/has_wifi' }])), true);
  assert.equal(seenFixedOnGoogle('website.booking.missing_on_gbp', 'update_booking_link', snap(loc(), [{ name: 'attributes/url_appointment' }])), true);
  assert.equal(seenFixedOnGoogle('gbp.change.description', null, snap(loc({ metadata: { hasGoogleUpdated: true } }))), false);
  assert.equal(seenFixedOnGoogle('gbp.change.description', null, snap(loc())), true);
  assert.equal(seenFixedOnGoogle('website.services.missing_on_gbp', 'update_services', snap(loc({ services: [{}] }), [], false)), null, 'failed read is unknown');
  assert.equal(seenFixedOnGoogle('website.gbp_services_not_on_site', null, snap(loc())), null, 'website work cannot be seen on Google');
  assert.equal(seenFixedOnGoogle('x', 'update_services', null), null);
});

test('list order: quick approvals first, then owner work, then what GrowwMatics runs; done last', () => {
  const doc = (id: string, capability: string | null, status: any, priority: any = 'medium', extra: any = {}) =>
    buildTaskView({ _id: id, findingId: id, capability, status, priority, description: id, ...extra }, new Set());
  const sorted = sortTasks([
    doc('confirmed', 'update_hours', 'VERIFIED'),
    doc('posts', 'google_posts', 'READY', 'high'),
    doc('website', null, 'PLANNED', 'high'),
    doc('done', 'update_services', 'EXECUTED'),
    doc('services', 'update_services', 'READY', 'low'),
    doc('attrs', 'update_attributes', 'READY', 'high'),
    doc('again', null, 'PLANNED', 'low', { reopenedAt: new Date() }),
  ]).map((t) => t.id);
  assert.deepEqual(sorted, ['again', 'attrs', 'services', 'website', 'posts', 'done', 'confirmed']);
});

test('summary and popup: once per report while something is open', () => {
  const v = (status: any, extra: any = {}) => buildTaskView({ _id: String(Math.random()), findingId: 'f', capability: 'update_services', status, description: 'd', ...extra }, new Set());
  const s = summarizeTasks([v('READY'), v('EXECUTED'), v('VERIFIED')]);
  assert.deepEqual(s, { total: 3, completed: 2, open: 1 });
  assert.equal(shouldShowTaskPopup(s, 'a1', null), true);
  assert.equal(shouldShowTaskPopup(s, 'a1', 'a1'), false, 'closed for this report');
  assert.equal(shouldShowTaskPopup(s, 'a2', 'a1'), true, 'a new report shows it again');
  assert.equal(shouldShowTaskPopup({ total: 2, completed: 2, open: 0 }, 'a2', null), false, 'nothing left to do');
  assert.equal(shouldShowTaskPopup(s, null, null), false, 'no connected report yet');
});

test('task view: plain-words reason, mark-done flag, done date', () => {
  const t = buildTaskView({ _id: 'w', findingId: 'website.gbp_services_not_on_site', capability: null, status: 'PLANNED', description: 'Add website pages', ownerMarkedDoneAt: '2026-11-05T10:00:00.000Z' }, new Set());
  assert.equal(t.status, 'done');
  assert.match(t.statusReason, /Marked done by you/);
  assert.equal(t.doneAt, '2026-11-05T10:00:00.000Z');
  assert.equal(t.canMarkDone, false, 'already done');
  const w = buildTaskView({ _id: 's', findingId: 'website.services.missing_on_gbp', capability: 'update_services', status: 'READY', description: 'Add services' }, new Set(['services']));
  assert.equal(w.status, 'waiting_approval');
  assert.match(w.statusReason, /approve/);
  assert.equal(w.actor, 'approve');
});
