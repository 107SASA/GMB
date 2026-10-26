jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/components/business-switcher', () => ({ BusinessSwitcher: () => null }));
jest.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Asha', phone: '+919000000001', email: 'a@example.invalid', role: 'CLIENT', subscription: null },
    logout: jest.fn(),
  }),
}));

import { fireEvent, render, screen } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import MoreScreen from '@/app/(app)/more';
import { getAccountDeletionUrl } from '@/lib/support';

const ORIGINAL = process.env.EXPO_PUBLIC_API_URL;
afterEach(() => {
  process.env.EXPO_PUBLIC_API_URL = ORIGINAL;
  jest.clearAllMocks();
});

function renderMore() {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <MoreScreen />
    </SafeAreaProvider>
  );
}

it('account deletion URL is the existing public website page', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://growwmatics.com/';
  expect(getAccountDeletionUrl()).toBe('https://growwmatics.com/delete-account');
  process.env.EXPO_PUBLIC_API_URL = '';
  expect(getAccountDeletionUrl()).toBeNull();
});

it('More → Legal opens the website privacy policy and account-deletion pages', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://growwmatics.com';
  renderMore();
  fireEvent.press(screen.getByText('Privacy policy'));
  expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith('https://growwmatics.com/privacy');
  fireEvent.press(screen.getByText('Delete account'));
  expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith('https://growwmatics.com/delete-account');
});

it('hides the legal links when the website URL is not configured', () => {
  process.env.EXPO_PUBLIC_API_URL = '';
  renderMore();
  expect(screen.queryByText('Privacy policy')).toBeNull();
  expect(screen.queryByText('Delete account')).toBeNull();
});
