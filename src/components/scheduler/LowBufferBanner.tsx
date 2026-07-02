import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface LowBufferBannerProps {
  missingDays: number;
  onGenerate: () => void;
}

export default function LowBufferBanner({ missingDays, onGenerate }: LowBufferBannerProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    await onGenerate();
    setIsGenerating(false);
  };

  if (missingDays === 0) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0, y: -10, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className="bg-rose-50 border border-rose-200 rounded-2xl p-5 shadow-sm mb-6 flex flex-col sm:flex-row justify-between items-center gap-4"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-rose-100 rounded-full flex items-center justify-center flex-shrink-0 text-rose-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h4 className="text-rose-900 font-bold text-lg">Action Required: Low Content Buffer</h4>
            <p className="text-rose-700 text-sm">You are missing content for {missingDays} days this week. Generate AI posts now to keep your audience engaged.</p>
          </div>
        </div>
        
        <button 
          onClick={handleGenerate}
          disabled={isGenerating}
          className="flex-shrink-0 w-full sm:w-auto px-6 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-sm transition-all disabled:opacity-70 flex items-center justify-center gap-2"
        >
          {isGenerating ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating via Inngest...
            </>
          ) : (
            'Generate Now'
          )}
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
