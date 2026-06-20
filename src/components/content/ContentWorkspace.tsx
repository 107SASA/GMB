'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ContentGeneratorForm from './ContentGeneratorForm';
import WeeklyPostsTab from './WeeklyPostsTab';
import SEOTab from './SEOTab';
import FAQTab from './FAQTab';
import ContentHistoryTab from './ContentHistoryTab';

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

  const handleGenerate = async (formData: any) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error);

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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Content Workspace</h1>
          <p className="text-slate-500 mt-1">Review, edit, and schedule your AI-generated content.</p>
        </div>
        <button
          onClick={() => setContentData(null)}
          className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
        >
          &larr; Generate New Content
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 bg-slate-50/50 px-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-4 px-6 font-medium text-sm transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'border-slate-900 text-slate-900 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-8 bg-white min-h-150">
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
