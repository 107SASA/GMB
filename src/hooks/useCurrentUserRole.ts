'use client';

import { useEffect, useState } from 'react';

type Role = 'SUPER_ADMIN' | 'CLIENT';

/**
 * Fetches the current session's role from the existing /api/auth/me endpoint.
 * Used purely for UI-level visibility decisions (e.g. hiding the Super
 * Admin–exclusive WhatsApp AI Agent link). This is NOT a security boundary —
 * every route and API this gates also enforces the check server-side.
 */
export function useCurrentUserRole() {
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/auth/me')
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        if (!cancelled && json?.success) {
          setRole(json.user.role);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { role, isSuperAdmin: role === 'SUPER_ADMIN', loading };
}
