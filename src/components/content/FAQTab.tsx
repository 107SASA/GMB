'use client';

import { useState } from 'react';
import { GeneratedFAQ } from '@/services/ai/contentEngine';
import { motion, AnimatePresence } from 'framer-motion';

interface FAQTabProps {
  faqs: GeneratedFAQ[];
}

export default function FAQTab({ faqs: initialFaqs }: FAQTabProps) {
  const [faqs] = useState(initialFaqs);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'saved' | 'error' | null>(null);
  const [saveError, setSaveError] = useState('');

  const toggleFaq = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  const handleCopyAll = () => {
    const text = faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
    navigator.clipboard.writeText(text);
  };

  const handleSaveFAQs = async () => {
    setIsSaving(true);
    setSaveResult(null);
    setSaveError('');
    try {
      const res = await fetch('/api/content/faqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faqs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save FAQs');
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
          <h3 className="text-xl font-bold text-slate-900">Frequently Asked Questions</h3>
          <p className="text-slate-500 text-sm mt-1">
            Add these to your Google Business Profile Q&amp;A section.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveResult === 'saved' && (
            <span className="text-xs text-green-600 font-medium flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Saved to business profile
            </span>
          )}
          {saveResult === 'error' && (
            <span className="text-xs text-red-500">{saveError}</span>
          )}
          <button
            onClick={handleSaveFAQs}
            disabled={isSaving}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-60"
          >
            {isSaving ? 'Saving…' : 'Save FAQs'}
          </button>
          <button
            onClick={handleCopyAll}
            className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-2 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy All
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {faqs.map((faq, index) => (
          <div key={index} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <button
              onClick={() => toggleFaq(index)}
              className="w-full px-6 py-4 flex justify-between items-center bg-white hover:bg-slate-50 transition-colors text-left"
            >
              <span className="font-semibold text-slate-900 flex items-center gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 text-xs flex items-center justify-center font-bold">
                  {index + 1}
                </span>
                {faq.question}
              </span>
              <svg
                className={`w-5 h-5 text-slate-400 transition-transform ${expandedIndex === index ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <AnimatePresence>
              {expandedIndex === index && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="px-6 pb-4 pt-1"
                >
                  <div className="pl-9 pr-4 text-slate-600 text-sm leading-relaxed border-t border-transparent">
                    {faq.answer}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}
