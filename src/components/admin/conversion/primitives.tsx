'use client';

/**
 * Small shared building blocks for the SuperAdmin Conversion Dashboard
 * (Overview, Pipeline, Lead detail, Demos). Kept deliberately plain — CSS
 * bars over a charting lib where a chart wouldn't add real information.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

export function KpiCard({
  label,
  value,
  sub,
  href,
  accent,
}: {
  label: string;
  value: string | number | null;
  sub?: string;
  href?: string;
  accent?: 'primary' | 'warning' | 'error' | 'neutral';
}) {
  const ring =
    accent === 'error'
      ? 'border-error-container'
      : accent === 'warning'
        ? 'border-warning/40'
        : accent === 'primary'
          ? 'border-primary-fixed-dim'
          : 'border-outline-variant';
  const body = (
    <div className={`bg-surface-container-lowest p-4 rounded-xl border ${ring} card-shadow h-full ${href ? 'hover:border-primary transition-colors' : ''}`}>
      <p className="text-xs font-medium text-on-surface-variant">{label}</p>
      <p className="text-2xl font-bold text-on-surface mt-1">
        {value === null || value === undefined ? <span className="text-outline text-base font-normal">No data yet</span> : value}
      </p>
      {sub && <p className="text-xs text-outline mt-0.5">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** Horizontal conversion funnel — each step a bar proportional to the top. */
export function Funnel({ steps }: { steps: { key: string; label: string; count: number; href?: string }[] }) {
  const top = Math.max(1, steps[0]?.count ?? 1);
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => {
        const width = Math.max(2, Math.round((s.count / top) * 100));
        const prev = i > 0 ? steps[i - 1].count : s.count;
        const drop = prev > 0 ? Math.round(((prev - s.count) / prev) * 100) : 0;
        const row = (
          <div className="group">
            <div className="flex items-center justify-between text-xs mb-0.5">
              <span className="font-medium text-on-surface">{s.label}</span>
              <span className="text-on-surface-variant">
                {s.count.toLocaleString()}
                {i > 0 && drop > 0 && <span className="text-outline"> · −{drop}%</span>}
              </span>
            </div>
            <div className="h-6 rounded-md bg-surface-container overflow-hidden">
              <div
                className="h-full bg-linear-to-r from-primary to-primary-container group-hover:opacity-90 transition-all"
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
        return (
          <div key={s.key}>
            {s.href ? <Link href={s.href} className="block">{row}</Link> : row}
          </div>
        );
      })}
    </div>
  );
}

const OWNERSHIP_STYLES: Record<string, string> = {
  AI: 'bg-primary-fixed text-primary',
  HUMAN: 'bg-warning/20 text-warning-text',
  CUSTOMER: 'bg-secondary-container/50 text-on-secondary-container',
};

export function OwnershipBadge({ ownership }: { ownership: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${OWNERSHIP_STYLES[ownership] ?? 'bg-surface-container text-on-surface-variant'}`}>
      {ownership === 'AI' ? 'AI' : ownership === 'HUMAN' ? 'Human' : 'Customer'}
    </span>
  );
}

export function StageBadge({ stage }: { stage: string | null }) {
  if (!stage) return <span className="text-outline text-xs">—</span>;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-surface-container text-on-surface-variant">
      {stage}
    </span>
  );
}

export function ScoreBar({ score }: { score: number | null | undefined }) {
  const v = Math.max(0, Math.min(100, score ?? 0));
  const color = v >= 75 ? 'bg-secondary' : v >= 45 ? 'bg-primary' : v >= 15 ? 'bg-warning' : 'bg-outline';
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-1.5 rounded-full bg-surface-container overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs tabular-nums text-on-surface-variant">{v}</span>
    </div>
  );
}

/** Relative time — computed after mount so render stays pure. */
export function RelTime({ date }: { date: string | null | undefined }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!date) return <span className="text-outline text-xs">—</span>;
  const d = new Date(date);
  if (now === null) {
    // First paint (and SSR): show an absolute date, no "x ago" flicker.
    return (
      <span className="text-xs text-on-surface-variant" title={d.toLocaleString()}>
        {d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
      </span>
    );
  }
  const mins = Math.round((now - d.getTime()) / 60000);
  const abs = Math.abs(mins);
  const fut = mins < 0;
  let label: string;
  const rel = (n: number, unit: string) => (fut ? `in ${n}${unit}` : `${n}${unit} ago`);
  if (abs < 1) label = 'just now';
  else if (abs < 60) label = rel(abs, 'm');
  else if (abs < 1440) label = rel(Math.round(abs / 60), 'h');
  else if (abs < 43200) label = rel(Math.round(abs / 1440), 'd');
  else label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return <span className="text-xs text-on-surface-variant" title={d.toLocaleString()}>{label}</span>;
}

export const RANGE_OPTIONS: { key: string; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' },
];

export function RangePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden text-xs">
      {RANGE_OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`px-3 py-1.5 font-medium transition-colors ${
            value === o.key ? 'bg-primary text-white' : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
