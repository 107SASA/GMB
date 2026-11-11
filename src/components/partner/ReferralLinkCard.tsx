'use client';

import { useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

/** The partner's shareable referral link, with copy + share buttons. */
export function ReferralLinkCard({ link, code, clicks }: { link: string; code: string; clicks: number }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked — the text is selectable */
    }
  };
  const share = async () => {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      await (navigator as any).share({ title: 'Growwmatics AI', text: 'Grow your business on Google with Growwmatics AI', url: link }).catch(() => {});
    } else {
      copy(link, 'link');
    }
  };

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Your referral link</p>
        <span className="text-xs text-on-surface-variant">{clicks.toLocaleString('en-IN')} visits</span>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate text-sm bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-on-surface select-all">{link}</code>
        <button onClick={() => copy(link, 'link')} className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium bg-primary text-on-primary min-h-11 shrink-0">
          <MaterialIcon name={copied === 'link' ? 'check' : 'content_copy'} size={16} />
          {copied === 'link' ? 'Copied' : 'Copy'}
        </button>
        <button onClick={share} aria-label="Share link" className="flex items-center justify-center px-3 py-2 rounded-lg bg-surface-container min-h-11 min-w-11 shrink-0">
          <MaterialIcon name="share" size={18} />
        </button>
      </div>
      <p className="text-xs text-on-surface-variant mt-3">
        Businesses that open this link and then get a free report, book a demo or sign up within 30 days are credited to you.
        Your code: <button onClick={() => copy(code, 'code')} className="font-mono font-semibold text-primary">{code}</button>
        {copied === 'code' ? ' — copied' : ''}
      </p>
    </div>
  );
}
