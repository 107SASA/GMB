import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { setAuthToken, setModuleLockedHandler, setUnauthorizedHandler } from '@/api/client';
import { fetchCurrentUser, login as apiLogin, type CurrentUser } from '@/api/endpoints/auth';
import {
  registerForPushNotifications,
  unregisterPushNotifications,
} from '@/notifications/push';

const TOKEN_KEY = 'auth_token';

interface AuthContextValue {
  /** True while the stored session is being restored on app launch. */
  isHydrating: boolean;
  /** Signed-in user (null when logged out). */
  user: CurrentUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetches /api/auth/me (e.g. after subscription changes). */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isHydrating, setIsHydrating] = useState(true);
  const [user, setUser] = useState<CurrentUser | null>(null);

  const clearSession = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {
      // Nothing actionable if the keychain entry is already gone.
    });
  }, []);

  // Restore the session on launch: token from SecureStore → /api/auth/me.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!token) return;
        setAuthToken(token);
        const me = await fetchCurrentUser();
        if (!cancelled) setUser(me);
        // Keep the device's push token registered — silent: never prompts
        // for permission on plain app open, only re-registers if granted.
        void registerForPushNotifications(false);
      } catch {
        // Expired/invalid token, or the server was unreachable. Treat as
        // logged out; the 401 interceptor has already cleared what it can.
        if (!cancelled) await clearSession();
      } finally {
        if (!cancelled) setIsHydrating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  // Any 401 on an authenticated endpoint force-logs-out.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearSession();
    });
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  // Keep entitlements fresh: re-pull /api/auth/me when the app comes back
  // to the foreground (throttled), and immediately when any request hits a
  // 403 MODULE_LOCKED (stale client). A website purchase therefore unlocks
  // the app within one refresh — no reinstall.
  const lastUserRefresh = useRef(0);
  const throttledRefresh = useCallback(() => {
    if (Date.now() - lastUserRefresh.current < 30_000) return;
    lastUserRefresh.current = Date.now();
    fetchCurrentUser()
      .then(setUser)
      .catch(() => {
        // Transient failure — the 401 interceptor handles real session loss.
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    setModuleLockedHandler(throttledRefresh);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') throttledRefresh();
    });
    return () => {
      setModuleLockedHandler(null);
      sub.remove();
    };
  }, [user, throttledRefresh]);

  const login = useCallback(async (email: string, password: string) => {
    const { token } = await apiLogin(email, password);
    setAuthToken(token);
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    const me = await fetchCurrentUser();
    setUser(me);
    // After an explicit login is the one moment we may show the OS
    // notification-permission prompt. Fire-and-forget: login must not
    // block on it.
    void registerForPushNotifications(true);
  }, []);

  const logout = useCallback(async () => {
    // Remove this device's push token first — the DELETE needs the still-
    // valid Authorization header. Best-effort; dead tokens are also pruned
    // server-side.
    await unregisterPushNotifications();
    // The mobile session is a stateless JWT — logout is purely local.
    // (POST /api/auth/logout only clears the web cookie.)
    await clearSession();
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const me = await fetchCurrentUser();
    setUser(me);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isHydrating,
      user,
      isAuthenticated: user !== null,
      login,
      logout,
      refreshUser,
    }),
    [isHydrating, user, login, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
