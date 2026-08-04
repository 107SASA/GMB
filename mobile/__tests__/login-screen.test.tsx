import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

jest.mock('@/api/endpoints/auth', () => ({
  login: jest.fn(async () => ({ token: 'test-token' })),
  fetchCurrentUser: jest.fn(async () => ({ id: 'u1', name: 'Test', email: 't@e.com' })),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

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

test('real app: type + press Sign in on the real nested (auth) Stack does not throw', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation((...args) => {
    console.log('[console.error]', args.map(String).join(' '));
  });
  let caught: unknown = null;

  try {
    console.log('[test] renderRouter with real src/app (app group stubbed)...');
    renderRouter(
      {
        appDir: './src/app',
        overrides: {
          '(app)/_layout': AppGroupStub,
        },
      },
      { initialUrl: '/login' }
    );

    console.log('[test] waiting for Email field...');
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Email')).toBeTruthy();
    });

    console.log('[test] typing credentials...');
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'a@b.com');
    });
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
    });

    console.log('[test] pressing Sign in...');
    await act(async () => {
      fireEvent.press(screen.getByText('Sign in'));
    });

    console.log('[test] press done, waiting for App group stub...');
    await waitFor(
      () => {
        expect(screen.getByText('App group stub')).toBeTruthy();
      },
      { timeout: 8000 }
    );
    console.log('[test] navigated to (app) group successfully.');
  } catch (err) {
    caught = err;
    console.log('[test] CAUGHT:', err instanceof Error ? err.stack : String(err));
  }

  consoleError.mockRestore();
  expect(caught).toBeNull();
}, 20000);
