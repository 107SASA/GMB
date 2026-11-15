'use client';

import { useMemo, useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

export interface PickerWorkspace {
  id: string;
  name: string;
  subtitle: string;
  planActive: boolean;
  lastUsed: boolean;
}

/** Above this many workspaces (agencies), show a search box. */
const SEARCH_THRESHOLD = 6;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export default function WorkspacePicker({ workspaces }: { workspaces: PickerWorkspace[] }) {
  const [query, setQuery] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter((w) => w.name.toLowerCase().includes(q) || w.subtitle.toLowerCase().includes(q));
  }, [query, workspaces]);

  const open = async (id: string) => {
    if (openingId) return;
    setOpeningId(id);
    setError('');
    try {
      const res = await fetch('/api/business/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: id }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) throw new Error('switch failed');
      // Full navigation so the dashboard's BusinessContext loads this workspace fresh.
      window.location.href = '/dashboard';
    } catch {
      setOpeningId(null);
      setError("Couldn't open that workspace. Please try again.");
    }
  };

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  };

  if (workspaces.length === 0) {
    return (
      <div className="bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-6 sm:p-10 text-center">
        <p className="text-on-surface font-medium">You don&apos;t have a workspace yet.</p>
        <a
          href="/onboarding"
          className="inline-flex items-center justify-center gap-2 mt-5 px-5 py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all"
        >
          Set up your business
        </a>
      </div>
    );
  }

  return (
    <div>
      {workspaces.length > SEARCH_THRESHOLD && (
        <div className="relative mb-4">
          <MaterialIcon name="search" size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workspaces"
            aria-label="Search workspaces"
            className="w-full pl-10 pr-4 py-3 text-base bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
          />
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 p-4 bg-error-container border border-outline-variant text-on-error-container text-sm font-medium rounded-lg text-center">
          {error}
        </div>
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {visible.map((w) => {
          const opening = openingId === w.id;
          return (
            <li key={w.id} className="min-w-0">
              <button
                type="button"
                onClick={() => void open(w.id)}
                disabled={!!openingId}
                aria-label={`Open ${w.name}${w.planActive ? ' (Pro)' : ' (Free)'}${w.lastUsed ? ', last used' : ''}`}
                className={`group w-full h-full text-left flex items-center gap-3 sm:gap-4 p-4 sm:p-5 rounded-xl border bg-surface-container-lowest card-shadow transition-all
                  hover:border-primary hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                  disabled:cursor-wait ${w.lastUsed ? 'border-primary/60 ring-1 ring-primary/30' : 'border-outline-variant'}
                  ${openingId && !opening ? 'opacity-50' : ''}`}
              >
                <span
                  aria-hidden
                  className={`shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-sm sm:text-base
                    ${w.planActive ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'}`}
                >
                  {initials(w.name)}
                </span>

                <span className="flex-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full
                        ${w.planActive ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'}`}
                    >
                      {w.planActive ? 'Pro' : 'Free'}
                    </span>
                    {w.lastUsed && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        Last used
                      </span>
                    )}
                  </span>
                  <span className="block font-semibold text-on-surface truncate">{w.name}</span>
                  {w.subtitle && <span className="block text-xs text-on-surface-variant truncate mt-0.5">{w.subtitle}</span>}
                </span>

                <span className="shrink-0 text-outline group-hover:text-primary transition-colors">
                  {opening ? (
                    <MaterialIcon name="progress_activity" size={22} className="animate-spin text-primary" />
                  ) : (
                    <MaterialIcon name="arrow_forward" size={22} />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {visible.length === 0 && (
        <p className="text-center text-sm text-on-surface-variant py-8">No workspace matches &ldquo;{query}&rdquo;.</p>
      )}

      <p className="text-center text-sm text-on-surface-variant mt-8">
        Not you?{' '}
        <button type="button" onClick={() => void signOut()} className="text-primary hover:text-primary-container font-medium">
          Sign out
        </button>
      </p>
    </div>
  );
}
