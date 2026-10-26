import { useSyncExternalStore } from 'react';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { getApiErrorMessage } from '@/api/client';
import { createGoogleConnectLink } from '@/api/endpoints/googleConnect';
import { queryClient } from '@/app/_layout';
import { ConfirmSheet } from '@/components/ui';

/**
 * Shared "connect Google Business Profile" prompt + flow.
 *
 * GBP OAuth has no native mobile flow and the iOS in-app browser shares no
 * cookies with the app or Safari, so the web's /api/auth/google route can't
 * see who the user is. Instead the app asks the backend for a single-use,
 * 2-minute handoff link (POST /api/auth/google/mobile-handoff, authenticated
 * by the app's own session + active workspace) and opens it in an EPHEMERAL
 * auth session: the short web session it sets never reaches Safari and is
 * discarded when the sheet closes.
 *
 * The web flow doesn't redirect back into the app, so the sheet closes when
 * the user taps Done; everything is refetched then, so every GBP-dependent
 * screen reflects the new connection without a manual refresh.
 *
 * `promptConnectGoogle` is called from several unrelated screens, so a tiny
 * module-level store + one host mounted at the root (below) keeps every call
 * site a one-liner.
 */

interface PromptState {
  message: string;
  /** Set when getting the handoff link failed — the sheet offers a retry. */
  failed?: boolean;
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

/**
 * Opens Google Business Profile OAuth for the active workspace and resolves
 * when the sheet closes. Throws if the handoff link can't be created (offline,
 * signed out, no workspace access).
 */
export async function openGoogleConnect(): Promise<void> {
  const url = await createGoogleConnectLink();
  try {
    await WebBrowser.openAuthSessionAsync(url, Linking.createURL('google-connected'), {
      preferEphemeralSession: true,
    });
  } finally {
    void queryClient.invalidateQueries({ predicate: () => true });
  }
}

export function promptConnectGoogle(message: string): void {
  setState({ message });
}

export function dismissConnectGooglePrompt(): void {
  setState(null);
}

export function acceptConnectGooglePrompt(): void {
  setState(null);
  openGoogleConnect().catch((err) => {
    setState({
      message: getApiErrorMessage(err, "Couldn't start the Google connection. Please try again."),
      failed: true,
    });
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
      title={prompt?.failed ? "Couldn't open Google" : 'Connect Google Business Profile'}
      message={prompt?.message ?? ''}
      confirmLabel={prompt?.failed ? 'Try again' : 'Connect'}
      cancelLabel="Not now"
    />
  );
}
