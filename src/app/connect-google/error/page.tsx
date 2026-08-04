'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

const REASON_MESSAGES: Record<string, string> = {
  expired_link: 'This connect link has expired. Please ask for a new one on WhatsApp.',
  not_configured: "This feature isn't fully set up yet. Please try again shortly.",
  state_mismatch: 'Your session expired mid-connection. Please try again from WhatsApp.',
  no_code: 'Google did not return a valid response. Please try again.',
  token_exchange_failed: 'Could not complete the connection with Google. Please try again.',
  google_denied: 'You did not grant access to your Google Business Profile.',
  gbp_api_access: "We don't have permission to read your Business Profile yet. Please contact support.",
  gbp_api_error: 'Google Business Profile is temporarily unavailable. Please try again shortly.',
  no_gbp_account: "This Google account doesn't manage any Business Profile listings.",
  no_gbp_locations: "This Google account doesn't manage any Business Profile listings.",
  conversation_not_found: 'This connect link is no longer valid. Please ask for a new one on WhatsApp.',
};

export default function ConnectGoogleErrorPage() {
  return (
    <Suspense fallback={null}>
      <ConnectGoogleErrorContent />
    </Suspense>
  );
}

function ConnectGoogleErrorContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason') || '';
  const message = REASON_MESSAGES[reason] || 'Something went wrong while connecting your Google Business Profile.';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-10 text-center">
        <div className="w-14 h-14 bg-error-container rounded-full flex items-center justify-center mx-auto mb-6">
          <MaterialIcon name="cancel" size={28} className="text-error" />
        </div>
        <h1 className="text-headline-md font-heading text-on-surface mb-2">Couldn&apos;t connect</h1>
        <p className="text-on-surface-variant">{message}</p>
      </div>
    </div>
  );
}
