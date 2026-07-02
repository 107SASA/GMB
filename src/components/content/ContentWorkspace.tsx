'use client';

import { useState } from 'react';
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

export default function ContentWorkspace() {
  const [activeTab, setActiveTab] = useState<TabId>('posts');
  const [contentData, setContentData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [upgradeMsg, setUpgradeMsg] = useState<string | null>(null);

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

  if (!contentData) {
    return (
      <div className="max-w-3xl mx-auto mt-10">
        <ContentGeneratorForm onGenerate={handleGenerate} isLoading={isLoading} />
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
