/**
 * No purchase-directed links or calls to action anywhere an iOS user can see
 * them (App Store guideline 3.1.1(a)), while account status, trial, renewal,
 * usage and cancellation information stay visible. Server strings below are
 * copied verbatim from the backend so a wording change there shows up here.
 */
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(), openAuthSessionAsync: jest.fn() }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Warning: 'warning' },
}));
jest.mock('@/api/endpoints/account', () => ({
  fetchBillingStatus: jest.fn(),
  fetchUsage: jest.fn(),
  cancelSubscription: jest.fn(),
}));
jest.mock('@/business/BusinessContext', () => ({ useBusiness: () => ({ activeBusinessId: 'biz-1' }) }));
jest.mock('@/auth/AuthContext', () => ({ useAuth: jest.fn() }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/api/client';
import { fetchBillingStatus, fetchUsage } from '@/api/endpoints/account';
import BillingScreen from '@/app/(app)/billing';
import LoginScreen from '@/app/(auth)/login';
import { useAuth } from '@/auth/AuthContext';
import { LockedScreen } from '@/components/locked';
import { containsPurchaseCta, NO_ACCOUNT_MESSAGE, storeSafeNotificationBody } from '@/lib/storeCompliance';

const PURCHASE_WORDING = /pricing|view plans|upgrade|subscribe|buy|purchase|checkout|free report|book a demo|renew to|reactivate|update your payment/i;
const DAY = 24 * 60 * 60 * 1000;

// gcTime: Infinity — no garbage-collection timer, so Jest can exit.
const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((c) => c.clear()));

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  clients.push(client);
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** Every piece of visible text on screen, joined. */
function allText(): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === 'object' && 'children' in (node as object)) walk((node as { children: unknown }).children);
  };
  walk(screen.toJSON());
  return out.join(' ');
}

describe('billing notifications from the server', () => {
  // src/services/inngest/functions.ts (subscription_expiry)
  it('subscription ending: keeps the end date, drops "Renew to keep everything unlocked"', () => {
    const body = 'Access to Asha Salon ends on 3 Nov 2026. Renew to keep everything unlocked — no data is lost.';
    expect(storeSafeNotificationBody('subscription_expiry', body)).toBe('Access to Asha Salon ends on 3 Nov 2026.');
  });

  // src/lib/billing/applyEntitlements.ts (billing_canceled)
  it('subscription cancelled: keeps the status, drops "Reactivate any time from Billing"', () => {
    const body = 'The subscription for Asha Salon has been canceled. Reactivate any time from Billing.';
    expect(storeSafeNotificationBody('billing_canceled', body)).toBe('The subscription for Asha Salon has been canceled.');
  });

  // src/lib/billing/applyEntitlements.ts (billing_past_due, with grace)
  it('payment failed: keeps the failure, drops "Update your payment method…"', () => {
    const body = "We couldn't process your payment for Asha Salon. Update your payment method by 30 Oct to keep full access.";
    expect(storeSafeNotificationBody('billing_past_due', body)).toBe("We couldn't process your payment for Asha Salon.");
  });

  it('account-status notifications without a call to action are shown unchanged', () => {
    const unchanged: Array<[string, string]> = [
      ['billing_past_due', "We couldn't process your payment for Asha Salon. Paid features are paused until the payment goes through — your data is safe."],
      ['billing_trial_started', 'Your free trial for Asha Salon is active until 1 Dec 2026. Your yearly plan starts then unless you cancel before.'],
      ['billing_trial_cancelled', "Your free trial for Asha Salon was cancelled. You keep full access until 1 Dec 2026 and won't be charged."],
      ['billing_renewed', 'We received your payment for Asha Salon. Our team will restore full access shortly.'],
      ['review_new', 'Renew your thanks to Asha — she left 5 stars.'],
    ];
    for (const [type, body] of unchanged) expect(storeSafeNotificationBody(type, body)).toBe(body);
  });
});

describe('server error messages', () => {
  it('a server message asking the user to subscribe falls back to the caller\'s neutral text', () => {
    const err = Object.assign(new Error('403'), {
      isAxiosError: true,
      response: { status: 403, data: { error: 'This workspace has used its free audit. Subscribe to keep auditing this business.' } },
    });
    expect(getApiErrorMessage(err, 'Could not start the audit.')).toBe('Could not start the audit.');
  });

  it('ordinary server messages are still shown', () => {
    const err = Object.assign(new Error('400'), {
      isAxiosError: true,
      response: { status: 400, data: { error: 'You can save up to 20 keywords.' } },
    });
    expect(getApiErrorMessage(err, 'fallback')).toBe('You can save up to 20 keywords.');
    expect(containsPurchaseCta('You can save up to 20 keywords.')).toBe(false);
  });
});

describe('sign-in with a number that has no account', () => {
  it('shows neutral copy instead of the server\'s free report / demo prompt', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      loginWithPhone: jest.fn(),
      // src/app/api/auth/phone-login/request/route.ts (404, noAccount)
      requestPhoneOtp: jest.fn(async () => {
        throw Object.assign(new Error('404'), {
          isAxiosError: true,
          response: {
            status: 404,
            data: { success: false, error: 'No account found for this number. Get your free report or book a demo to get started.', noAccount: true },
          },
        });
      }),
    });
    wrap(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('98765 43210'), '9876543210');
    fireEvent.press(screen.getByText('Send code on WhatsApp'));
    await waitFor(() => expect(screen.getByText(NO_ACCOUNT_MESSAGE)).toBeTruthy());
    expect(allText()).not.toMatch(PURCHASE_WORDING);
  });
});

describe('billing screen by account state', () => {
  const usage = {
    plan: 'Growth',
    limits: { maxAuditsPerBusiness: 4, maxPostsPerMonth: 16, maxWhatsAppMessagesPerDay: 100 },
    usage: { auditsUsed: 1, postsUsed: 3, whatsappUsed: 0 },
  };
  const sub = (over: Record<string, unknown>) => ({
    planType: 'Growth',
    billingStatus: 'Active',
    trialStatus: null,
    modules: { reputation_agent: { enabled: true } },
    hasPaymentMethod: true,
    currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString(),
    ...over,
  });
  const show = async (subscription: object, workspace: object | null, authSub: object | null) => {
    (useAuth as jest.Mock).mockReturnValue({ user: { subscription: authSub } });
    (fetchBillingStatus as jest.Mock).mockResolvedValue({ subscription, workspace });
    (fetchUsage as jest.Mock).mockResolvedValue(usage);
    wrap(<BillingScreen />);
    await waitFor(() => expect(screen.getByText(/plan$/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Posts')).toBeTruthy());
  };

  afterEach(() => {
    expect(allText()).not.toMatch(PURCHASE_WORDING);
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });

  it('free: plan and usage, no purchase prompt, no cancel', async () => {
    await show(sub({ planType: 'Free', hasPaymentMethod: false, modules: {} }), null, null);
    expect(screen.getByText('Free plan')).toBeTruthy();
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('trial: trial end date and days-left banner stay visible', async () => {
    const endsAt = new Date(Date.now() + 5 * DAY).toISOString();
    await show(
      sub({ billingStatus: 'Trialing', trialStatus: { isActive: true, endsAt } }),
      null,
      { billingStatus: 'Trialing', trialSource: 'offer', trialStatus: { isActive: true, endsAt }, modules: {} }
    );
    expect(screen.getByText(/^Trial ends (?!in )/)).toBeTruthy(); // the date line
    expect(screen.getByText(/Trial ends in 5 days/)).toBeTruthy();
  });

  it('paid: renewal date, enabled modules, usage and Cancel stay visible', async () => {
    await show(sub({}), { subscriptionStatus: 'active', isActive: true, currentPeriodEnd: null, cancelAtPeriodEnd: false }, null);
    expect(screen.getByText(/^Renews /)).toBeTruthy();
    expect(screen.getByText('Reviews & Reputation')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('paid, cancellation scheduled: end date shown, no renew prompt', async () => {
    await show(sub({}), { subscriptionStatus: 'active', isActive: true, currentPeriodEnd: null, cancelAtPeriodEnd: true }, null);
    expect(screen.getByText(/won.t renew/)).toBeTruthy();
    expect(screen.getByText('Cancellation scheduled')).toBeTruthy();
  });

  it('past due: neutral billing-issue banner only', async () => {
    await show(sub({ billingStatus: 'PastDue' }), null, { billingStatus: 'PastDue', modules: {} });
    expect(screen.getByText("There's a billing issue on your account.")).toBeTruthy();
  });
});

describe('locked feature screen', () => {
  it('says the feature is not in the plan, with no link or purchase prompt', () => {
    (useAuth as jest.Mock).mockReturnValue({ user: { subscription: { modules: {} } } });
    wrap(<LockedScreen surface="reviews" />);
    expect(screen.getByText("This feature isn't included in your current plan.")).toBeTruthy();
    expect(allText()).not.toMatch(PURCHASE_WORDING);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
