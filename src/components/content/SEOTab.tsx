'use client';

import { useState } from 'react';
import { useBusiness } from '@/context/BusinessContext';

interface SEOTabProps {
  description: string;
  score: number;
}

export default function SEOTab({ description: initialDescription, score }: SEOTabProps) {
  const { activeBusiness } = useBusiness();
  const [description, setDescription] = useState(initialDescription);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'saved' | 'error' | null>(null);
  const [saveError, setSaveError] = useState('');

  const handleCopy = () => {
    navigator.clipboard.writeText(description);
  };

  const handleSaveToProfile = async () => {
    if (!activeBusiness) return;
    setIsSaving(true);
    setSaveResult(null);
    setSaveError('');
    try {
      const res = await fetch(`/api/business/${activeBusiness._id}/seo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setSaveResult('saved');
    } catch (err: any) {
      setSaveError(err.message);
      setSaveResult('error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h3 className="text-xl font-bold text-slate-900">SEO Optimized Description</h3>
          <p className="text-slate-500 text-sm mt-1">
            Perfect for your Google Business Profile description box (Max 750 chars).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">SEO Score</span>
            <span
              className={`text-xl font-bold ${
                score >= 80 ? 'text-green-600' : score >= 60 ? 'text-amber-500' : 'text-red-500'
              }`}
            >
              {score}/100
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-1 border-b border-slate-100 bg-slate-50 flex justify-end">
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy
          </button>
        </div>
        <textarea
          value={description}
          onChange={(e) => { setDescription(e.target.value); setSaveResult(null); }}
          className="w-full h-64 p-6 text-slate-700 leading-relaxed resize-none focus:outline-none focus:ring-0 border-0"
          maxLength={750}
        />
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
          <span
            className={`text-xs font-medium ${
              description.length > 750 ? 'text-red-500' : 'text-slate-500'
            }`}
          >
            {description.length} / 750 characters
          </span>

          <div className="flex items-center gap-3">
            {saveResult === 'saved' && (
              <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Saved to profile notes
              </span>
            )}
            {saveResult === 'error' && (
              <span className="text-xs text-red-500">{saveError}</span>
            )}
            <button
              onClick={handleSaveToProfile}
              disabled={isSaving || !activeBusiness}
              className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save to Profile Notes'}
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 text-center">
        Saves to your GrowwMatics AI business profile. To push directly to Google Business Profile, connect your Google account.
      </p>
    </div>
  );
}
