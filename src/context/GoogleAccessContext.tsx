'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useBusiness } from '@/context/BusinessContext';

/**
 * Google access state of the active workspace (GET /api/gbp/access), shared
 * by the header chip, the dashboard banner and the "access problem" popup.
 * While the first check is running it re-reads every 20 s (for 5 min).
 */
export type GoogleAccessStatus = 'not_connected' | 'checking' | 'verified' | 'limited' | 'blocked';

export interface GoogleAccessInfo {
  status: GoogleAccessStatus;
  reason?: string | null;
  detail?: string | null;
  googleEmail?: string | null;
  checkedAt?: string | null;
  canPost?: boolean | null;
  canEdit?: boolean | null;
  reconnect?: boolean;
  copy?: { title: string; body: string; steps: string[]; reconnect: boolean } | null;
}

interface Ctx {
  access: GoogleAccessInfo | null;
  refresh: () => Promise<void>;
  /** "Check again": runs the Google sync (re-checks access), then re-reads. */
  checkAgain: () => Promise<{ ok: boolean; error?: string }>;
  checking: boolean;
}

const GoogleAccessContext = createContext<Ctx>({
  access: null,
  refresh: async () => {},
  checkAgain: async () => ({ ok: false }),
  checking: false,
});

export function GoogleAccessProvider({ children }: { children: React.ReactNode }) {
  const { activeBusiness } = useBusiness();
  const businessId = activeBusiness?._id;
  const [access, setAccess] = useState<GoogleAccessInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const pollStarted = useRef<number>(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/gbp/access', { cache: 'no-store' });
      if (!res.ok) return;
      setAccess(await res.json());
    } catch { /* keep the last known state */ }
  }, []);

  useEffect(() => {
    setAccess(null);
    pollStarted.current = Date.now();
    if (businessId) void refresh();
  }, [businessId, refresh]);

  useEffect(() => {
    if (access?.status !== 'checking') return;
    if (Date.now() - pollStarted.current > 5 * 60_000) return;
    const t = setTimeout(() => void refresh(), 20_000);
    return () => clearTimeout(t);
  }, [access, refresh]);

  const checkAgain = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/gbp/sync', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      await refresh();
      if (!res.ok) return { ok: false, error: j.error || 'Could not check right now — please try again in a minute.' };
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not check right now — please try again in a minute.' };
    } finally {
      setChecking(false);
    }
  }, [refresh]);

  return (
    <GoogleAccessContext.Provider value={{ access, refresh, checkAgain, checking }}>
      {children}
    </GoogleAccessContext.Provider>
  );
}

export function useGoogleAccess(): Ctx {
  return useContext(GoogleAccessContext);
}

export const isAccessProblem = (s?: GoogleAccessStatus | null) => s === 'limited' || s === 'blocked';
