'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBusiness } from '@/context/BusinessContext';
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

// Target Keywords persist in localStorage so they survive refresh / re-login.
// The key is PER-WORKSPACE (keyed by businessId) — previously it was a single
// global key, so switching workspaces made e.g. a hospital inherit an IT
// company's keywords ("Full Stack Development"). A keyword must contain a
// letter, which drops junk like "." or "123" that leaked in before.
const KEYWORDS_STORAGE_PREFIX = 'gmb_content_generator_keywords';
const keywordsKey = (businessId: string) => `${KEYWORDS_STORAGE_PREFIX}:${businessId}`;
const isValidKeyword = (v: string) => /[a-zA-Z]/.test(v);

function loadStoredKeywords(businessId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = window.localStorage.getItem(keywordsKey(businessId));
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string' && isValidKeyword(k)) : [];
  } catch {
    return [];
  }
}

export default function ContentWorkspace() {
  const { activeBusiness } = useBusiness();
  const businessId = activeBusiness?._id;

  const [activeTab, setActiveTab] = useState<TabId>('posts');
  const [contentData, setContentData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [upgradeMsg, setUpgradeMsg] = useState<string | null>(null);

  // Keyword state lives here (not inside ContentGeneratorForm) so it survives
  // the form unmounting after generation and remounting via "Generate New Content".
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');

  // Load THIS workspace's saved keywords whenever the active workspace changes,
  // so keywords never leak across workspaces. Empty when none saved — the form
  // then seeds from the business's own profile keywords.
  useEffect(() => {
    if (!businessId) return;
    setKeywords(loadStoredKeywords(businessId));
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    try {
      window.localStorage.setItem(keywordsKey(businessId), JSON.stringify(keywords));
    } catch {
      // Storage unavailable (e.g. private browsing) — keywords still work
      // for the current in-memory session via React state.
    }
  }, [keywords, businessId]);

  const handleGenerate = async (formData: any) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      // The response may not be JSON (e.g. a gateway 504 HTML page) — parse
      // defensively so the user sees a clear message, not "Unexpected token '<'".
      let result: any = null;
      try {
        result = await response.json();
      } catch {
        result = null;
      }

      if (!response.ok || !result) {
        if (result?.code === 'UPGRADE_REQUIRED') {
          setUpgradeMsg(result.error);
          return;
        }
        throw new Error(
          result?.error ||
            (response.status === 504
              ? 'The server took too long to respond. Your content may still be generating — check Content History in a moment.'
              : `Generation failed (HTTP ${response.status}).`)
        );
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
