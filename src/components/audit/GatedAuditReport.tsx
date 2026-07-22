'use client';

import { useEffect, useState } from 'react';
import AuditResultsDashboard from './AuditResultsDashboard';
import AuditPaywallSidebar from './AuditPaywallSidebar';

/**
 * Renders the audit report, with the upgrade pricing card alongside it for
 * users still on the freemium gate.
 *
 * Composed at this level on purpose: AuditResultsDashboard has three separate
 * render branches (V7 / V6 / legacy) and rewriting each into a two-column
 * layout would mean touching all of them. Wrapping keeps the report components
 * untouched — the sidebar simply sits next to whichever one renders.
 *
 * The report itself is never hidden or truncated: it stays free to read and to
 * come back to. Only the rest of the dashboard is behind payment (enforced in
 * src/proxy.ts, not here — this component is presentation only).
 */
export default function GatedAuditReport({ auditId }: { auditId: string }) {
  const [gated, setGated] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setGated(!!d?.user?.freemiumAuditGate?.active))
      .catch(() => setGated(false));
  }, []);

  // Status-only poll so the sidebar copy can differ while the report builds.
  // AuditResultsDashboard does its own polling for the report body itself.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    const check = async () => {
      try {
        const res = await fetch(`/api/audit/${auditId}`);
        const json = await res.json();
        const pending = json?.audit?.status === 'PENDING';
        setGenerating(pending);
        if (!pending) clearInterval(timer);
      } catch {
        clearInterval(timer);
      }
    };
    check();
    timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, [auditId]);

  // Until we know, render the report alone — never flash a paywall at a
  // paying customer.
  if (gated !== true) {
    return <AuditResultsDashboard auditId={auditId} />;
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col items-start gap-6 lg:flex-row">
      <div className="min-w-0 w-full flex-1">
        <AuditResultsDashboard auditId={auditId} />
      </div>
      <AuditPaywallSidebar generating={generating} />
    </div>
  );
}
