import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { fetchBillingStatus } from '@/api/endpoints/account';
import { fetchBusinesses } from '@/api/endpoints/businesses';
import { BusinessProvider, useBusiness } from '@/business/BusinessContext';

// The app must not run the post-payment intake (or open the tabs) for an
// unpaid workspace — same rule as the web's WorkspaceLockGate / proxy.ts.

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, isHydrating: false, user: { id: 'u1' } }),
}));

jest.mock('@/api/client', () => ({ setActiveBusinessIdHeader: jest.fn() }));

jest.mock('@/api/endpoints/businesses', () => ({
  fetchBusinesses: jest.fn(),
  deleteWorkspace: jest.fn(),
}));

jest.mock('@/api/endpoints/account', () => ({ fetchBillingStatus: jest.fn() }));

const newBusiness = {
  _id: 'b1',
  name: 'Demo Cafe',
  intakeCompleted: false,
  googleConnected: false,
  createdAt: '2026-10-20T00:00:00.000Z',
};

function billing(isActive: boolean) {
  return {
    subscription: { planType: 'Free', billingStatus: 'Active' },
    workspace: { subscriptionStatus: isActive ? 'active' : 'trialing', isActive, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  };
}

const clients: QueryClient[] = [];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return (
    <QueryClientProvider client={client}>
      <BusinessProvider>{children}</BusinessProvider>
    </QueryClientProvider>
  );
}

// The locked state polls every 30s — stop it so jest can exit.
afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
});

beforeEach(() => {
  (fetchBusinesses as jest.Mock).mockResolvedValue([newBusiness]);
});

it('locks an unpaid workspace and skips the intake', async () => {
  (fetchBillingStatus as jest.Mock).mockResolvedValue(billing(false));
  const { result } = renderHook(() => useBusiness(), { wrapper });
  await waitFor(() => expect(result.current.workspaceLocked).toBe(true));
  expect(result.current.isLoading).toBe(false);
  expect(result.current.needsOnboarding).toBe(false);
});

it('sends a paid workspace to the intake', async () => {
  (fetchBillingStatus as jest.Mock).mockResolvedValue(billing(true));
  const { result } = renderHook(() => useBusiness(), { wrapper });
  await waitFor(() => expect(result.current.onboardingStep).toBe('intake'));
  expect(result.current.workspaceLocked).toBe(false);
});

it('fails open when the billing check errors', async () => {
  (fetchBillingStatus as jest.Mock).mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useBusiness(), { wrapper });
  await waitFor(() => expect(result.current.onboardingStep).toBe('intake'));
  expect(result.current.workspaceLocked).toBe(false);
});

it('a failed payment after the grace period locks with the "paused" reason', async () => {
  (fetchBillingStatus as jest.Mock).mockResolvedValue({
    ...billing(false),
    workspace: {
      ...billing(false).workspace,
      subscriptionStatus: 'past_due',
      access: { mode: 'restricted', restrictedModules: ['reputation_agent', 'sales_agent', 'content_studio', 'marketing_automation'] },
    },
  });
  const { result } = renderHook(() => useBusiness(), { wrapper });
  await waitFor(() => expect(result.current.workspaceLocked).toBe(true));
  expect(result.current.workspaceLockReason).toBe('payment_failed');
});

it('a failed payment restricting only some modules keeps the workspace open, like the web', async () => {
  (fetchBillingStatus as jest.Mock).mockResolvedValue({
    ...billing(false),
    workspace: {
      ...billing(false).workspace,
      subscriptionStatus: 'past_due',
      access: { mode: 'restricted', restrictedModules: ['sales_agent'] },
    },
  });
  const { result } = renderHook(() => useBusiness(), { wrapper });
  await waitFor(() => expect(result.current.workspaceRestrictedModules).toEqual(['sales_agent']));
  expect(result.current.workspaceLocked).toBe(false);
});
