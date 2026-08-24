'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useBusiness } from '@/context/BusinessContext';
import ContentGeneratorForm from './ContentGeneratorForm';
import WeeklyPostsTab from './WeeklyPostsTab';
import SEOTab from './SEOTab';
import FAQTab from './FAQTab';
import ContentHistoryTab from './ContentHistoryTab';
import SchedulerDashboard from '@/components/scheduler/SchedulerDashboard';
import UpgradeLimitModal from '@/components/ui/UpgradeLimitModal';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

// Top-level sections (Bug 11 + Bug 14: land on what already exists instead of
// dropping straight into generation, and fold the formerly-separate Content
// Scheduler page in here as a tab instead of a second nav item/route). Kept
// distinct from the inner post-generation result tabs below (weekly posts /
// SEO / FAQ), which only apply to one just-finished generation run.
type MainTabId = 'existing' | 'generate' | 'schedule';
type ResultTabId = 'posts' | 'seo' | 'faq';

const RESULT_TABS: { id: ResultTabId; label: string }[] = [
  { id: 'posts', label: 'Weekly Posts' },
  { id: 'seo', label: 'SEO Description' },
  { id: 'faq', label: 'FAQs' },
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
  const searchParams = useSearchParams();

  // Legacy links (old /dashboard/scheduler, /dashboard/posts/*) land here
  // with ?tab=schedule|generate so they still open the right section instead
  // of just bouncing to the new default.
  const requestedTab = searchParams.get('tab');
  const initialTab: MainTabId =
    requestedTab === 'schedule' || requestedTab === 'generate' ? requestedTab : 'existing';
  const [mainTab, setMainTab] = useState<MainTabId>(initialTab);

  const [resultTab, setResultTab] = useState<ResultTabId>('posts');
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
              ? 'The server took too long to respond. Your content may still be generating — check Existing Posts in a moment.'
              : `Generation failed (HTTP ${response.status}).`)
        );
      }

      setContentData(result.data);
      setResultTab('posts');
    } catch (error) {
      toast.error(friendlyClientMessage(error, 'Generation failed'));
    } finally {
      setIsLoading(false);
    }
  };

  const MAIN_TABS: { id: MainTabId; label: string }[] = [
    { id: 'existing', label: 'Existing Posts' },
    { id: 'generate', label: 'Generate' },
    { id: 'schedule', label: 'Schedule' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-on-surface">Content</h1>
        <p className="text-on-surface-variant mt-1">Review what you already have, generate new posts, and schedule them — all in one place.</p>
      </div>

      {upgradeMsg && (
        <UpgradeLimitModal message={upgradeMsg} onClose={() => setUpgradeMsg(null)} />
      )}

      {/* Main section nav */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant overflow-hidden">
        <div className="overflow-x-auto border-b border-outline-variant bg-surface/50">
          <div className="flex px-4 sm:px-6 min-w-max">
            {MAIN_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setMainTab(tab.id)}
                data-tour={tab.id === 'generate' ? 'generate-content' : undefined}
                className={`whitespace-nowrap py-4 px-5 sm:px-6 font-bold text-sm transition-colors border-b-2 ${
                  mainTab === tab.id
                    ? 'border-on-surface text-on-surface bg-surface-container-lowest'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-8 bg-surface-container-lowest min-h-150">
          <AnimatePresence mode="wait">
            {mainTab === 'existing' && (
              <motion.div key="existing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <div className="flex justify-end mb-4">
                  <button
                    onClick={() => setMainTab('generate')}
                    className="flex items-center gap-2 bg-primary hover:bg-primary-container text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors"
                  >
                    Generate New Posts
                  </button>
                </div>
                <ContentHistoryTab />
              </motion.div>
            )}

            {mainTab === 'generate' && (
              <motion.div key="generate" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                {!contentData ? (
                  <ContentGeneratorForm
                    onGenerate={handleGenerate}
                    isLoading={isLoading}
                    keywords={keywords}
                    setKeywords={setKeywords}
                    keywordInput={keywordInput}
                    setKeywordInput={setKeywordInput}
                  />
                ) : (
                  <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-2">
                      <div className="flex items-start gap-2.5 rounded-xl border border-primary-fixed-dim bg-primary-fixed px-4 py-3 text-sm text-primary flex-1">
                        <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>
                          Nothing here is posted anywhere yet — this is a draft. Click <strong>Schedule</strong> on a
                          post (or use Auto/Manual Schedule below) to queue it; it publishes to your Google Business
                          Profile automatically on its scheduled date. Every generated post — scheduled or not —
                          stays available under <strong>Existing Posts</strong>.
                        </span>
                      </div>
                      <button
                        onClick={() => setContentData(null)}
                        className="text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors self-start sm:self-auto shrink-0"
                      >
                        &larr; Generate New Content
                      </button>
                    </div>

                    <div className="border border-outline-variant rounded-xl overflow-hidden">
                      <div className="overflow-x-auto border-b border-outline-variant bg-surface/50">
                        <div className="flex px-2 min-w-max">
                          {RESULT_TABS.map((tab) => (
                            <button
                              key={tab.id}
                              onClick={() => setResultTab(tab.id)}
                              className={`whitespace-nowrap py-3 px-4 font-medium text-sm transition-colors border-b-2 ${
                                resultTab === tab.id
                                  ? 'border-on-surface text-on-surface bg-surface-container-lowest'
                                  : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="p-4 sm:p-6">
                        <AnimatePresence mode="wait">
                          {resultTab === 'posts' && (
                            <motion.div key="posts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                              <WeeklyPostsTab posts={contentData.posts} />
                            </motion.div>
                          )}
                          {resultTab === 'seo' && (
                            <motion.div key="seo" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                              <SEOTab description={contentData.seoDescription} score={contentData.seoScore} />
                            </motion.div>
                          )}
                          {resultTab === 'faq' && (
                            <motion.div key="faq" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                              <FAQTab faqs={contentData.faqs} />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {mainTab === 'schedule' && (
              <motion.div key="schedule" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <SchedulerDashboard />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
