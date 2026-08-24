import { useSyncExternalStore } from 'react';
import * as WebBrowser from 'expo-web-browser';

import { queryClient } from '@/app/_layout';
import { ConfirmSheet } from '@/components/ui';

/**
 * Shared "connect Google Business Profile" prompt — GBP OAuth has no native
 * mobile flow, so this opens the web dashboard's `/api/auth/google` route in
 * an in-app browser. Used wherever a workspace-scoped GBP call comes back
 * not-connected (reviews sync, media, dashboard, etc).
 *
 * `openBrowserAsync`'s promise resolves once the user dismisses the in-app
 * browser (there's no custom-scheme redirect wired up to intercept
 * completion earlier) — previously nothing happened at that point, so every
 * GBP-dependent screen (Settings' connection row, GBP tabs, Photos) kept
 * showing "not connected" until a manual pull-to-refresh or the global 60s
 * staleTime happened to lapse, even though the connection had actually
 * succeeded. Invalidating everything on return mirrors the pull-to-refresh
 * pattern already used elsewhere (e.g. dashboard.tsx) — this is a rare,
 * deliberate action, not a hot path, so a full refetch is cheap here.
 *
 * Themed replacement for what used to be `Alert.alert(...)` (the OS's plain
 * system dialog, off-theme against the rest of the app — Aug 2026
 * feedback). `promptConnectGoogle` is called from six unrelated screens/
 * components, so — unlike a one-off confirm local to a single screen (see
 * ConfirmSheet usage in more.tsx) — this is the one case in the app where a
 * tiny module-level store + a single host mounted at the root (below) beats
 * threading local state through every call site: it keeps every caller's
 * `promptConnectGoogle(message)` call exactly as imperative as the
 * Alert.alert it replaces, no hook/JSX wiring required at each of the six
 * sites.
 */

interface PromptState {
  message: string;
}

let state: PromptState | null = null;
const listeners = new Set<() => void>();

function setState(next: PromptState | null) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** Subscribed by ConnectGooglePromptHost (mounted once in app/_layout.tsx) — not for direct use elsewhere. */
export function useConnectGooglePromptState(): PromptState | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => state
  );
}

export function promptConnectGoogle(message: string): void {
  setState({ message });
}

export function dismissConnectGooglePrompt(): void {
  setState(null);
}

export function acceptConnectGooglePrompt(): void {
  setState(null);
  void WebBrowser.openBrowserAsync(`${process.env.EXPO_PUBLIC_API_URL}/api/auth/google`).then(() => {
    void queryClient.invalidateQueries({ predicate: () => true });
  });
}

/** Mount once near the app root (see app/_layout.tsx). */
export function ConnectGooglePromptHost() {
  const prompt = useConnectGooglePromptState();
  return (
    <ConfirmSheet
      visible={!!prompt}
      onCancel={dismissConnectGooglePrompt}
      onConfirm={acceptConnectGooglePrompt}
      title="Connect Google Business Profile"
      message={prompt?.message ?? ''}
      confirmLabel="Connect"
      cancelLabel="Not now"
    />
  );
}
