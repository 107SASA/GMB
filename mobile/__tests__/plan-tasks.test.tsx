import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { appPathForTaskLink, appPathForWebPath, isTaskPath } from '@/lib/taskLinks';
import { taskSchema } from '@/api/endpoints/tasks';

// Plan tasks (audit → fix → proof): links from the server, WhatsApp and push
// open the screen that fixes each issue; the audit screen lists the fixes.

jest.mock('@/business/BusinessContext', () => ({ useBusiness: () => ({ activeBusinessId: 'b1' }) }));

const task = (over: Record<string, unknown>) => ({
  id: 't', findingId: 'f', title: 'Fix', evidence: '', priority: 'medium', status: 'open', statusReason: '', actor: 'approve',
  ownerAction: 'Steps', growwmaticsAction: null, target: { screen: 'profile-optimization', section: 'services', mobile: '/profile-optimization?section=services', label: 'Add services' },
  canMarkDone: false, doneAt: null, confirmedAt: null, ...over,
});

jest.mock('@/api/endpoints/tasks', () => {
  const actual = jest.requireActual('@/api/endpoints/tasks');
  return {
    ...actual,
    fetchTasks: jest.fn(async () => ({
      tasks: [
        task({ id: 's', findingId: 'website.services.missing_on_gbp', title: 'Add your 6 services' }),
        task({ id: 'a', findingId: 'gbp.attributes.none', title: 'Set attributes', status: 'waiting_approval', target: { screen: 'profile-optimization', section: 'attributes', mobile: '/profile-optimization?section=attributes', label: 'Choose attributes' } }),
        task({ id: 'w', findingId: 'website.gbp_services_not_on_site', title: 'Add website pages', actor: 'owner', canMarkDone: true, target: { screen: 'instructions', mobile: null, label: 'How to do this' } }),
        task({ id: 'h', findingId: 'profile.business_hours.missing', title: 'Opening hours', status: 'done', doneAt: '2026-11-05T09:00:00.000Z' }),
        task({ id: 'x', findingId: 'not.in.this.report', title: 'Other report' }),
      ],
      summary: { total: 5, completed: 1, open: 4 },
      report: { auditId: 'a1', createdAt: '2026-10-28T00:00:00.000Z' },
      showPopup: false,
    })),
  };
});

test('only known fix screens are opened from push data', () => {
  expect(isTaskPath('/profile-optimization?section=services')).toBe(true);
  expect(isTaskPath('/gbp?section=details')).toBe(true);
  expect(isTaskPath('/photos')).toBe(true);
  expect(isTaskPath('/settings')).toBe(false);
  expect(isTaskPath('https://evil.example/x')).toBe(false);
  expect(isTaskPath('/profile-optimization?section=<script>')).toBe(false);
  expect(isTaskPath(42)).toBe(false);
});

test('website links map to the same fix in the app', () => {
  expect(appPathForTaskLink('/dashboard/profile-optimization?section=services')).toBe('/profile-optimization?section=services');
  expect(appPathForTaskLink('https://growwmatics.com/dashboard/profile-optimization?utm_source=wa&section=links')).toBe('/profile-optimization?section=links');
  expect(appPathForTaskLink('/dashboard/gbp-profile?section=photos')).toBe('/photos');
  expect(appPathForTaskLink('/dashboard/gbp-profile?section=details')).toBe('/gbp?section=details');
  expect(appPathForTaskLink('/dashboard/seo-plan')).toBe('/dashboard');
  expect(appPathForTaskLink('/dashboard/crm')).toBeNull();
  expect(appPathForTaskLink(null)).toBeNull();
});

test('App Links: website dashboard paths open the matching app screen', () => {
  expect(appPathForWebPath('/dashboard/profile-optimization', '?section=services')).toBe('/profile-optimization?section=services');
  expect(appPathForWebPath('/dashboard/audit/6aead2b56f3a40198f7ba54a')).toBe('/audit/6aead2b56f3a40198f7ba54a');
  expect(appPathForWebPath('/dashboard/billing')).toBe('/dashboard');
  expect(appPathForWebPath('/dashboard/')).toBe('/dashboard');
  expect(appPathForWebPath('/no-such-screen')).toBe('/');
});

test('a website link that reaches the app lands on the fix screen', async () => {
  function Fix() {
    const { useLocalSearchParams } = require('expo-router');
    const { section } = useLocalSearchParams();
    const { Text } = require('react-native');
    return <Text>{`PO:${section}`}</Text>;
  }
  const NotFound = require('@/app/+not-found').default;
  renderRouter({ 'profile-optimization': Fix, '+not-found': NotFound }, { initialUrl: '/dashboard/profile-optimization?section=services' });
  await waitFor(() => expect(screen.getByText('PO:services')).toBeTruthy());
});

test('a task from a newer server with unknown values still parses', () => {
  const t = taskSchema.parse({ ...task({}), status: 'something_new', actor: 'robot', target: { mobile: 5 } });
  expect(t.status).toBe('open');
  expect(t.actor).toBe('owner');
  expect(t.target.mobile).toBeNull();
  expect(t.target.label).toBe('How to do this');
});

test('audit screen fix list: this report only, live status, right buttons', async () => {
  const { ReportFixList } = require('@/components/plan-tasks');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Screen() {
    return (
      <QueryClientProvider client={client}>
        <ReportFixList findingIds={['website.services.missing_on_gbp', 'gbp.attributes.none', 'website.gbp_services_not_on_site', 'profile.business_hours.missing']} />
      </QueryClientProvider>
    );
  }
  renderRouter({ index: Screen }, { initialUrl: '/' });
  await waitFor(() => expect(screen.getByText('Fix these issues')).toBeTruthy());
  expect(screen.getByText(/1 of 4 done/)).toBeTruthy();
  expect(screen.queryByText('Other report')).toBeNull();
  expect(screen.getByText('Fix now')).toBeTruthy();
  expect(screen.getByText('Approve now')).toBeTruthy();
  expect(screen.getByText('Waiting for approval')).toBeTruthy();
  expect(screen.getByText('How to do this')).toBeTruthy();
  expect(screen.getByText(/^Done on /)).toBeTruthy();
});
