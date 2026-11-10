'use client';

import { useMemo } from 'react';
import { Download, CreditCard } from 'lucide-react';

/**
 * Leads from scanned visiting cards, grouped by "Where you met" (the event
 * tag the owner sets while scanning in the app). Computed from the lead list
 * the CRM page already loaded — no extra request.
 */

type Lead = any;

const NO_EVENT = '(No event)';

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralize spreadsheet formulas (CSV injection) and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function downloadLeadsCsv(leads: Lead[], fileName: string) {
  const header = ['Name', 'Phone', 'Email', 'Company', 'Job title', 'Website', 'Address', 'City', 'Other phones', 'Other emails', 'Met at', 'Stage', 'Deal value', 'Notes', 'Added on'];
  const rows = leads.map((l) => [
    l.name,
    l.phone,
    l.email,
    l.businessCard?.company,
    l.businessCard?.designation,
    l.businessCard?.website,
    l.businessCard?.address,
    l.city,
    (l.businessCard?.otherPhones ?? []).join('; '),
    (l.businessCard?.otherEmails ?? []).join('; '),
    l.businessCard?.metAt,
    l.lifeCycleStage,
    l.deal?.value ?? l.valuation ?? '',
    l.notes,
    l.createdAt ? new Date(l.createdAt).toLocaleDateString() : '',
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'event';

export default function EventsReport({ leads, onViewLeads }: { leads: Lead[]; onViewLeads: (metAt: string) => void }) {
  const cardLeads = useMemo(() => leads.filter((l) => l.businessCard), [leads]);

  const events = useMemo(() => {
    const map = new Map<string, { name: string; leads: Lead[]; active: number; won: number; wonValue: number; last: number }>();
    for (const l of cardLeads) {
      const name = l.businessCard?.metAt?.trim() || NO_EVENT;
      const e = map.get(name) ?? { name, leads: [] as Lead[], active: 0, won: 0, wonValue: 0, last: 0 };
      e.leads.push(l);
      if (l.lifeCycleStage === 'active') e.active += 1;
      if (l.lifeCycleStage === 'converted') {
        e.won += 1;
        e.wonValue += Number(l.deal?.value) || 0;
      }
      e.last = Math.max(e.last, new Date(l.businessCard?.scannedAt || l.createdAt || 0).getTime());
      map.set(name, e);
    }
    return Array.from(map.values()).sort((a, b) => b.last - a.last);
  }, [cardLeads]);

  if (cardLeads.length === 0) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-10 text-center">
        <CreditCard className="w-8 h-8 mx-auto text-on-surface-variant mb-3" />
        <p className="font-bold text-on-surface">No visiting cards scanned yet</p>
        <p className="text-sm text-on-surface-variant mt-1">
          In the Growwmatics AI app, open CRM → Scan card. Set &ldquo;Where you met&rdquo; and every lead from that event shows up here.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-outline-variant">
        <div>
          <h2 className="font-bold text-on-surface">Leads by event</h2>
          <p className="text-xs text-on-surface-variant">{cardLeads.length} visiting cards scanned</p>
        </div>
        <button
          onClick={() => downloadLeadsCsv(cardLeads, 'visiting-card-leads.csv')}
          className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-outline-variant hover:border-primary text-on-surface font-semibold text-xs rounded-xl"
        >
          <Download className="w-3.5 h-3.5" /> Export all (CSV)
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-on-surface-variant">
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3 text-right">Cards</th>
              <th className="px-4 py-3 text-right">In progress</th>
              <th className="px-4 py-3 text-right">Won</th>
              <th className="px-4 py-3 text-right">Won value</th>
              <th className="px-4 py-3">Last scan</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.name} className="border-t border-outline-variant">
                <td className="px-4 py-3 font-semibold text-on-surface">{e.name}</td>
                <td className="px-4 py-3 text-right">{e.leads.length}</td>
                <td className="px-4 py-3 text-right">{e.active}</td>
                <td className="px-4 py-3 text-right">{e.won}</td>
                <td className="px-4 py-3 text-right">{e.wonValue ? `₹${e.wonValue.toLocaleString('en-IN')}` : '—'}</td>
                <td className="px-4 py-3 text-on-surface-variant">{e.last ? new Date(e.last).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2 whitespace-nowrap">
                    {e.name !== NO_EVENT && (
                      <button onClick={() => onViewLeads(e.name)} className="text-xs font-bold text-primary hover:underline">
                        View leads
                      </button>
                    )}
                    <button
                      onClick={() => downloadLeadsCsv(e.leads, `leads-${slug(e.name)}.csv`)}
                      className="text-xs font-bold text-on-surface-variant hover:text-primary"
                    >
                      CSV
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
