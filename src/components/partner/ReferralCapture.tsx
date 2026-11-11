'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

const CODE_RE = /^GP-[A-HJKMNP-Z2-9]{6}$/i;

/**
 * Picks up ?ref=GP-XXXXXX on any page and asks the server to remember the
 * referring Growth Partner (cookie set server-side, httpOnly). Renders nothing.
 */
export function ReferralCapture() {
  const params = useSearchParams();
  const ref = params.get('ref');
  useEffect(() => {
    if (!ref || !CODE_RE.test(ref.trim())) return;
    fetch('/api/public/referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ref.trim() }),
      keepalive: true,
    }).catch(() => {});
  }, [ref]);
  return null;
}
