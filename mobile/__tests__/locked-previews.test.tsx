import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LockedScreen } from '@/components/locked';
import type { LockedPreviewKind } from '@/components/locked-previews';

// Free CRM accounts see a faded "Sample preview" of each locked tab behind the
// lock card (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md). Paid / other locked
// accounts keep the plain lock. No prices or buy wording anywhere (stores).

const mockBusiness = {
  freeCrm: { enabled: true, activeLeads: 3, maxActiveLeads: 200, scansUsed: 1, maxScansPerMonth: 50, scansResetAt: null } as unknown,
  activeBusiness: { _id: 'b1', name: 'Shree Shop', category: 'Grocery store' },
  activeBusinessId: 'b1',
};

jest.mock('@/business/BusinessContext', () => ({ useBusiness: () => mockBusiness }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/components/workspace-inactive', () => ({ ACTIVATE_MESSAGE: 'help' }));
jest.mock('@/lib/support', () => ({ getSupportWhatsAppLink: () => 'https://wa.me/1' }));
jest.mock('@/components/onboarding/StepBusinessSearch', () => ({ StepBusinessSearch: () => null }));
jest.mock('@/api/endpoints/freeReport', () => ({
  fetchFreeReport: jest.fn(async () => ({
    success: true,
    hasListing: true,
    businessName: 'Shree Shop',
    report: { auditId: 'a1', status: 'ready', score: 83, topFixes: ['No phone number on the Google listing'], createdAt: null, reportUrl: null },
  })),
  startFreeReport: jest.fn(),
}));
jest.mock('@/entitlements/entitlements', () => ({
  MODULE_NAMES: { google_ranking_agent: 'Google Ranking', reputation_agent: 'Reviews & Reputation', sales_agent: 'Inbox & Leads', content_studio: 'Content Studio', marketing_automation: 'Campaigns' },
  SURFACE_MODULES: { dashboard: 'google_ranking_agent', reviews: 'reputation_agent', scheduler: 'content_studio', content: 'content_studio', leads: 'sales_agent', inbox: 'sales_agent', campaigns: 'marketing_automation' },
  useEntitlements: () => ({ isTrialing: false, trialDaysLeft: 0, isPastDue: false }),
}));

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </SafeAreaProvider>
  );
}

const PURCHASE = /(₹|\$|price|pricing|buy|purchase|upgrade|subscribe|checkout)/i;

function allText(): string {
  return screen.toJSON() ? JSON.stringify(screen.toJSON()) : '';
}

describe('Free CRM lock screens with a sample preview', () => {
  beforeEach(() => {
    mockBusiness.freeCrm = { enabled: true } as unknown;
  });

  const cases: Array<[LockedPreviewKind, 'dashboard' | 'reviews' | 'scheduler', string]> = [
    ['home', 'dashboard', 'Your Google dashboard'],
    ['performance', 'dashboard', 'Google ranking'],
    ['posts', 'scheduler', 'Google posts'],
    ['reviews', 'reviews', 'Reviews'],
    ['profile', 'dashboard', 'Google profile'],
  ];

  it.each(cases)('%s: sample preview label, its own title, WhatsApp button, no purchase wording', async (kind, surface, title) => {
    wrap(<LockedScreen surface={surface} preview={kind} />);
    expect(screen.getByText('Sample preview')).toBeTruthy();
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByTestId('locked-preview')).toBeTruthy();
    expect(screen.getByText('Chat with us on WhatsApp')).toBeTruthy();
    expect(screen.getByText(/Your plan includes the CRM and visiting-card scan/)).toBeTruthy();
    await waitFor(() => expect(allText()).not.toMatch(PURCHASE));
  });

  it('posts preview uses the business name; performance shows the real report score', async () => {
    const { unmount } = wrap(<LockedScreen surface="scheduler" preview="posts" />);
    expect(screen.getByText('New this week at Shree Shop')).toBeTruthy();
    unmount();
    wrap(<LockedScreen surface="dashboard" preview="performance" />);
    await waitFor(() => expect(screen.getByText('83')).toBeTruthy());
  });

  it('the free report card is on Home only', async () => {
    const { unmount } = wrap(<LockedScreen surface="dashboard" preview="home" />);
    await waitFor(() => expect(screen.getByText('Your free Google profile report')).toBeTruthy());
    unmount();
    wrap(<LockedScreen surface="reviews" preview="reviews" />);
    await waitFor(() => expect(screen.queryByText('Your free Google profile report')).toBeNull());
  });

  it('accounts that are not on the Free CRM tier keep the plain lock (no preview)', () => {
    mockBusiness.freeCrm = null;
    wrap(<LockedScreen surface="scheduler" preview="posts" />);
    expect(screen.queryByText('Sample preview')).toBeNull();
    expect(screen.queryByTestId('locked-preview')).toBeNull();
    expect(screen.getByText("This feature isn't included in your current plan.")).toBeTruthy();
  });
});
