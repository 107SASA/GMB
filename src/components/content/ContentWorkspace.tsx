'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ContentGeneratorForm from './ContentGeneratorForm';
import WeeklyPostsTab from './WeeklyPostsTab';
import SEOTab from './SEOTab';
import FAQTab from './FAQTab';
import ContentHistoryTab from './ContentHistoryTab';
import UpgradeLimitModal from '@/components/ui/UpgradeLimitModal';

type TabId = 'posts' | 'seo' | 'faq' | 'history';

const TABS: { id: TabId; label: string }[] = [
  { id: 'posts', label: 'Weekly Posts' },
  { id: 'seo', label: 'SEO Description' },
  { id: 'faq', label: 'FAQs' },
  { id: 'history', label: 'Content History' },
];

// Same client-storage approach already used elsewhere in the app (see the
// audit history page's use of localStorage) — reusing localStorage here (not
// sessionStorage) so Target Keywords survive not just navigating away and
// back, but also logging out and back in, closing the tab, or refreshing —
// all without any backend/API change. The user only loses them by explicitly
// removing/clearing/replacing keywords in the UI.
const KEYWORDS_STORAGE_KEY = 'gmb_content_generator_keywords';

function loadStoredKeywords(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = window.localStorage.getItem(KEYWORDS_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function ContentWorkspace() {
  const [activeTab, setActiveTab] = useState<TabId>('posts');
  const [contentData, setContentData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [upgradeMsg, setUpgradeMsg] = useState<string | null>(null);

  // Keyword state lives here (not inside ContentGeneratorForm) so it survives
  // the form unmounting after generation and remounting via "Generate New Content".
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');

  // Hydrate from localStorage after mount (not in the initializer) so the
  // client's first render matches the server-rendered HTML and avoids a
  // hydration mismatch; this restores keywords saved from any earlier visit
  // — including a previous login session.
  useEffect(() => {
    const stored = loadStoredKeywords();
    if (stored.length > 0) setKeywords(stored);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEYWORDS_STORAGE_KEY, JSON.stringify(keywords));
    } catch {
      // Storage unavailable (e.g. private browsing) — keywords still work
      // for the current in-memory session via React state.
    }
  }, [keywords]);

  const handleGenerate = async (formData: any) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const result = await response.json();
      if (!response.ok) {
        if (result.code === 'UPGRADE_REQUIRED') {
          setUpgradeMsg(result.error);
          return;
        }
        throw new Error(result.error);
      }

      setContentData(result.data);
      setActiveTab('posts');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Generation failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Lets users reach Content History immediately, without generating content
  // first. Reuses the exact same <ContentHistoryTab /> used in the post-
  // generation tab view below — no duplicate history UI/logic.
  const [showHistory, setShowHistory] = useState(false);

  if (showHistory) {
    return (
      <div className="max-w-5xl mx-auto mt-10 space-y-6">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Content Workspace</h1>
            <p className="text-slate-500 mt-1">Review, edit, and schedule your AI-generated content.</p>
          </div>
          <button
            onClick={() => setShowHistory(false)}
            className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
          >
            &larr; Back to Generator
          </button>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden p-4 sm:p-8">
          <ContentHistoryTab />
        </div>
      </div>
    );
  }

  if (!contentData) {
    return (
      <div className="max-w-3xl mx-auto mt-10">
        <div className="flex justify-end mb-3">
          <button
            onClick={() => setShowHistory(true)}
            className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
          >
            View Content History &rarr;
          </button>
        </div>
        <ContentGeneratorForm
          onGenerate={handleGenerate}
          isLoading={isLoading}
          keywords={keywords}
          setKeywords={setKeywords}
          keywordInput={keywordInput}
          setKeywordInput={setKeywordInput}
        />
        {upgradeMsg && (
          <UpgradeLimitModal message={upgradeMsg} onClose={() => setUpgradeMsg(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Content Workspace</h1>
          <p className="text-slate-500 mt-1">Review, edit, and schedule your AI-generated content.</p>
        </div>
        <button
          onClick={() => setContentData(null)}
          className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors self-start sm:self-auto"
        >
          &larr; Generate New Content
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Tab Navigation — horizontally scrollable on narrow screens */}
        <div className="overflow-x-auto border-b border-slate-200 bg-slate-50/50">
          <div className="flex px-4 sm:px-6 min-w-max">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap py-4 px-5 sm:px-6 font-medium text-sm transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'border-slate-900 text-slate-900 bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-4 sm:p-8 bg-white min-h-150">
          <AnimatePresence mode="wait">
            {activeTab === 'posts' && (
              <motion.div
                key="posts"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <WeeklyPostsTab posts={contentData.posts} />
              </motion.div>
            )}
            {activeTab === 'seo' && (
              <motion.div
                key="seo"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <SEOTab description={contentData.seoDescription} score={contentData.seoScore} />
              </motion.div>
            )}
            {activeTab === 'faq' && (
              <motion.div
                key="faq"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <FAQTab faqs={contentData.faqs} />
              </motion.div>
            )}
            {activeTab === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <ContentHistoryTab />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
