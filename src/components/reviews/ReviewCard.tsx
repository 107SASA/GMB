import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ReviewCardProps {
  review: any;
  onGenerateReply: (id: string, tone: string) => Promise<void>;
  onPostReply: (id: string, replyText: string) => Promise<void>;
}

export default function ReviewCard({ review, onGenerateReply, onPostReply }: ReviewCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [tone, setTone] = useState('Professional');
  const [generating, setGenerating] = useState(false);
  const [posting, setPosting] = useState(false);
  const [editableReply, setEditableReply] = useState('');

  // Sync state if AI generates reply
  React.useEffect(() => {
    if (review.aiSuggestedReply) {
      setEditableReply(review.aiSuggestedReply);
    }
  }, [review.aiSuggestedReply]);

  const handleGenerate = async () => {
    setGenerating(true);
    await onGenerateReply(review._id, tone);
    setGenerating(false);
  };

  const handlePost = async () => {
    setPosting(true);
    await onPostReply(review._id, editableReply || review.aiSuggestedReply);
    setPosting(false);
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'positive': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'neutral': return 'bg-slate-100 text-slate-800 border-slate-200';
      case 'negative': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'critical': return 'bg-rose-100 text-rose-800 border-rose-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const getAvatarInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-4 transition-all hover:shadow-md">
      <div className="p-5 flex flex-col md:flex-row gap-5">
        {/* Left side: Avatar & Rating */}
        <div className="flex-shrink-0 flex md:flex-col items-center md:items-start gap-4 md:w-48">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-sm">
              {getAvatarInitials(review.reviewer)}
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-sm">{review.reviewer}</h4>
              <p className="text-xs text-slate-500">{new Date(review.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
          
          <div className="flex flex-col gap-1.5 ml-auto md:ml-0">
            <div className="flex text-amber-400 text-sm">
              {[...Array(5)].map((_, i) => (
                <svg key={i} className={`w-4 h-4 ${i < review.rating ? 'fill-current' : 'text-slate-200 fill-current'}`} viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <div className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border inline-block max-w-max ${getSentimentColor(review.sentiment)}`}>
              {review.sentiment}
            </div>
          </div>
        </div>

        {/* Right side: Review Text & Actions */}
        <div className="flex-grow">
          <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">{review.reviewText}</p>
          
          {review.replyStatus === 'POSTED' ? (
            <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Replied on {new Date(review.updatedAt).toLocaleDateString()}</h5>
              <p className="text-slate-800 text-sm">{review.response}</p>
            </div>
          ) : (
            <div className="mt-4 border-t border-slate-100 pt-4 flex gap-2">
              <button 
                onClick={() => setExpanded(!expanded)}
                className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg transition-colors"
              >
                {expanded ? 'Close Reply Workspace' : 'Reply to Review'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Reply Workspace */}
      <AnimatePresence>
        {expanded && review.replyStatus !== 'POSTED' && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-slate-200 bg-slate-50 p-5 overflow-hidden"
          >
            <div className="flex flex-col gap-4 max-w-3xl">
              <div className="flex gap-2">
                {['Professional', 'Friendly', 'Apology', 'Empathetic'].map(t => (
                  <button 
                    key={t}
                    onClick={() => setTone(t)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                      tone === t ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <textarea 
                value={editableReply}
                onChange={(e) => setEditableReply(e.target.value)}
                placeholder="Click 'Generate AI Reply' or type your own response..."
                className="w-full min-h-[120px] p-4 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-y"
              />

              <div className="flex justify-between items-center">
                <button 
                  onClick={handleGenerate}
                  disabled={generating}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-70"
                >
                  {generating ? 'Generating...' : '✨ Generate AI Reply'}
                </button>

                <button 
                  onClick={handlePost}
                  disabled={posting || !editableReply.trim()}
                  className="flex items-center gap-2 px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  {posting ? 'Publishing...' : 'Approve & Post'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
