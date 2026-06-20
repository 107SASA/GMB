'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useBusiness } from '@/context/BusinessContext';

interface ContentGeneratorFormProps {
  onGenerate: (data: any) => void;
  isLoading: boolean;
}

export default function ContentGeneratorForm({ onGenerate, isLoading }: ContentGeneratorFormProps) {
  const { activeBusiness, loading: businessLoading } = useBusiness();

  const [formData, setFormData] = useState({
    businessName: '',
    businessType: '',
    location: '',
    tone: 'Professional',
  });

  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [contentTypes, setContentTypes] = useState<string[]>(['GMB Posts', 'SEO Description', 'FAQs']);
  const [showOverrideFields, setShowOverrideFields] = useState(false);

  // Pre-fill from the active business whenever it resolves or changes
  useEffect(() => {
    if (!activeBusiness) return;
    const locationStr = [activeBusiness.city, activeBusiness.state].filter(Boolean).join(', ');
    setFormData({
      businessName: activeBusiness.name,
      businessType: activeBusiness.userDefinedCategory || activeBusiness.category || '',
      location: locationStr,
      tone: 'Professional',
    });
    if (activeBusiness.keywords?.length) {
      setKeywords(activeBusiness.keywords);
    }
  }, [activeBusiness]);

  const handleAddKeyword = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && keywordInput.trim()) {
      e.preventDefault();
      if (!keywords.includes(keywordInput.trim())) {
        setKeywords([...keywords, keywordInput.trim()]);
      }
      setKeywordInput('');
    }
  };

  const handleRemoveKeyword = (tag: string) => {
    setKeywords(keywords.filter((k) => k !== tag));
  };

  const toggleContentType = (type: string) => {
    setContentTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Auto-add any keyword still sitting in the input (user forgot to press Enter)
    const finalKeywords = [...keywords];
    if (keywordInput.trim() && !finalKeywords.includes(keywordInput.trim())) {
      finalKeywords.push(keywordInput.trim());
      setKeywords(finalKeywords);
      setKeywordInput('');
    }

    if (finalKeywords.length === 0) {
      alert('Please add at least one keyword.');
      return;
    }
    if (contentTypes.length === 0) {
      alert('Please select at least one content type.');
      return;
    }
    onGenerate({ ...formData, keywords: finalKeywords, contentTypes });
  };

  const isBusinessPrefilled = !businessLoading && !!activeBusiness;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8"
    >
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-900">AI Content Studio</h2>
        <p className="text-slate-500 mt-1">Generate high-converting GMB posts, SEO content, and FAQs instantly.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Business identity — compact strip when pre-filled, full fields otherwise */}
        {isBusinessPrefilled && !showOverrideFields ? (
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="text-sm text-slate-700">
              <span className="text-slate-400 mr-1">Generating for:</span>
              <span className="font-semibold">{formData.businessName}</span>
              {formData.location && (
                <span className="text-slate-500"> · {formData.location}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowOverrideFields(true)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors ml-4 whitespace-nowrap"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Business Name</label>
                <input
                  type="text"
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-colors"
                  placeholder="e.g. Sharma Enterprises"
                  value={formData.businessName}
                  onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Business Type / Category</label>
                <input
                  type="text"
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-colors"
                  placeholder="e.g. IT Services"
                  value={formData.businessType}
                  onChange={(e) => setFormData({ ...formData, businessType: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Target Location</label>
              <input
                type="text"
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-colors"
                placeholder="e.g. Delhi, India"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              />
            </div>
            {isBusinessPrefilled && (
              <button
                type="button"
                onClick={() => setShowOverrideFields(false)}
                className="text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
              >
                ← Use {activeBusiness!.name}
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Content Tone</label>
            <select
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-colors bg-white"
              value={formData.tone}
              onChange={(e) => setFormData({ ...formData, tone: e.target.value })}
            >
              <option value="Professional">Professional</option>
              <option value="Friendly">Friendly</option>
              <option value="Motivational">Motivational</option>
              <option value="Luxury">Luxury</option>
              <option value="Conversational">Conversational</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">
            Target Keywords <span className="text-slate-400 font-normal">(Press Enter to add)</span>
          </label>
          <input
            type="text"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-colors"
            placeholder="Type a keyword and press Enter..."
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={handleAddKeyword}
          />
          <div className="flex flex-wrap gap-2 mt-3">
            {keywords.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-800"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => handleRemoveKeyword(tag)}
                  className="ml-2 text-slate-400 hover:text-slate-600 focus:outline-none"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-semibold text-slate-700">What do you want to generate?</label>
          <div className="flex flex-wrap gap-3">
            {['GMB Posts', 'SEO Description', 'FAQs', 'Promotional Posts', 'Festival Posts'].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleContentType(type)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  contentTypes.includes(type)
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-4 px-6 rounded-xl text-white font-semibold text-lg transition-all shadow-md flex justify-center items-center gap-2 ${
            isLoading
              ? 'bg-slate-800 opacity-90 cursor-wait'
              : 'bg-slate-900 hover:bg-slate-800 hover:-translate-y-0.5 hover:shadow-lg'
          }`}
        >
          {isLoading ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Generating Magic...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate AI Workspace
            </>
          )}
        </button>
      </form>
    </motion.div>
  );
}
