'use client';

import { useEffect, useState } from 'react';
import { Headset, Mail, ExternalLink } from 'lucide-react';

export default function SupportPage() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(json => { if (json.success) setEmail(json.data.supportEmail || ''); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-11 h-11 bg-violet-600 rounded-xl flex items-center justify-center shadow-sm">
          <Headset className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Support</h1>
          <p className="text-sm text-slate-500">External support inbox access</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 mb-2">External Support</h3>
        <p className="text-slate-500 text-sm mb-6">
          Support is handled via your external support tool. Access your support inbox using the link below.
          To update the support email, go to{' '}
          <a href="/admin/settings" className="text-violet-600 hover:underline font-medium">
            Platform Settings
          </a>
          .
        </p>

        {loading ? (
          <div className="h-12 bg-slate-50 rounded-xl animate-pulse" />
        ) : email ? (
          <div className="flex flex-col gap-3">
            <a
              href={`mailto:${email}`}
              className="inline-flex items-center gap-3 px-5 py-3.5 bg-violet-600 text-white font-semibold text-sm rounded-xl hover:bg-violet-700 transition-colors shadow-sm w-fit"
            >
              <Mail className="w-4 h-4" />
              Open Support Inbox
              <ExternalLink className="w-3.5 h-3.5 opacity-70" />
            </a>
            <p className="text-xs text-slate-400">{email}</p>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-100 rounded-xl">
            <Mail className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">No support email configured</p>
              <p className="text-xs text-amber-600 mt-0.5">
                Add a support email in{' '}
                <a href="/admin/settings" className="underline font-medium">Platform Settings</a>
                {' '}to enable this link.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
