'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { XCircle } from 'lucide-react';

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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 p-10 text-center">
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <XCircle className="w-7 h-7 text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Couldn't connect</h1>
        <p className="text-slate-500">{message}</p>
      </div>
    </div>
  );
}
