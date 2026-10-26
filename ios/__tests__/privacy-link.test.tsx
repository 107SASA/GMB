jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));
jest.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ requestPhoneOtp: jest.fn(), loginWithPhone: jest.fn() }),
}));

import { fireEvent, render, screen } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import LoginScreen from '@/app/(auth)/login';
import { getPrivacyPolicyUrl } from '@/lib/support';

const ORIGINAL = process.env.EXPO_PUBLIC_API_URL;
afterEach(() => {
  process.env.EXPO_PUBLIC_API_URL = ORIGINAL;
});

describe('getPrivacyPolicyUrl', () => {
  it('points at the website privacy page, tolerating a trailing slash', () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://growwmatics.com/';
    expect(getPrivacyPolicyUrl()).toBe('https://growwmatics.com/privacy');
  });

  it('is null when the API URL is not configured, so no broken link is shown', () => {
    process.env.EXPO_PUBLIC_API_URL = '';
    expect(getPrivacyPolicyUrl()).toBeNull();
  });
});

describe('login screen', () => {
  it('shows a privacy policy link before sign-in that opens the website policy', () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://growwmatics.com';
    render(<LoginScreen />);
    fireEvent.press(screen.getByText('Privacy policy'));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://growwmatics.com/privacy');
  });
});
