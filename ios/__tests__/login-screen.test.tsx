import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

jest.mock('@/api/endpoints/auth', () => ({
  requestPhoneLoginOtp: jest.fn(async () => ({ maskedPhone: '+91 ••••• 43210' })),
  verifyPhoneLoginOtp: jest.fn(async () => ({ token: 'test-token' })),
  fetchCurrentUser: jest.fn(async () => ({ id: 'u1', name: 'Test', email: 't@e.com' })),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => () => {}),
  fetch: jest.fn(async () => ({ isConnected: true })),
  useNetInfo: () => ({ isConnected: true }),
}));

jest.mock('@/notifications/push', () => ({
  registerForPushNotifications: jest.fn(async () => {}),
  unregisterPushNotifications: jest.fn(async () => {}),
  useLastNotificationResponse: () => null,
  pushSupported: false,
}));

// Route-tree construction eagerly loads every _layout.tsx under (app)/ to
// build the navigator config — none of it is needed for this repro (the
// crash happens before ever leaving the login screen), so it's stubbed to
// a trivial screen. Root _layout.tsx and the entire (auth) group stay 100%
// real — that's the exact nested Stack-in-Stack structure under test.
function AppGroupStub() {
  return <Text>App group stub</Text>;
}

test('real app: phone + WhatsApp code sign-in on the real nested (auth) Stack reaches the app', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation((...args) => {
    console.log('[console.error]', args.map(String).join(' '));
  });
  let caught: unknown = null;

  try {
    renderRouter(
      {
        appDir: './src/app',
        overrides: {
          '(app)/_layout': AppGroupStub,
        },
      },
      { initialUrl: '/login' }
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('98765 43210')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('98765 43210'), '9876543210');
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Send code on WhatsApp'));
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('······')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('······'), '123456');
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Verify & sign in'));
    });

    await waitFor(
      () => {
        expect(screen.getByText('App group stub')).toBeTruthy();
      },
      { timeout: 8000 }
    );
  } catch (err) {
    caught = err;
    console.log('[test] CAUGHT:', err instanceof Error ? err.stack : String(err));
  }

  consoleError.mockRestore();
  expect(caught).toBeNull();

  // Same backend contract as Android: the typed number and the 6-digit code.
  const auth = jest.requireMock('@/api/endpoints/auth');
  expect(auth.requestPhoneLoginOtp).toHaveBeenCalledWith(expect.stringContaining('9876543210'));
  expect(auth.verifyPhoneLoginOtp).toHaveBeenCalledWith(expect.stringContaining('9876543210'), '123456');
}, 20000);
