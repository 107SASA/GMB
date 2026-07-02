import { motion, AnimatePresence } from 'framer-motion';
import { X, Flame, Clock, Calendar, Lightbulb, Activity, Zap } from 'lucide-react';
import { format } from 'date-fns';

function ScoreRing({ score }: { score: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * (score / 100);
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      <svg width="64" height="64" className="-rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle
          cx="32" cy="32" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute text-sm font-black" style={{ color }}>{score}</span>
    </div>
  );
}

export default function LeadDetailsDrawer({ lead, onClose }: any) {
  if (!lead) return null;

  const score: number = lead.aiLeadScore ?? 0;
  const hasScore = lead.aiLeadScore != null;
  const scoreColor = score >= 80 ? 'text-green-600' : score >= 50 ? 'text-amber-500' : 'text-red-500';
  const scoreBg = score >= 80 ? 'bg-green-50 border-green-100' : score >= 50 ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100';

  // Derive booking interest from real data, not a missing field
  const bookingEvidence =
    lead.interest?.toLowerCase().includes('book') ||
    lead.interest?.toLowerCase().includes('demo') ||
    lead.aiInsights?.toLowerCase().includes('book') ||
    lead.aiInsights?.toLowerCase().includes('demo');

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, x: "100%" }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="w-full max-w-md bg-white h-full border-l border-slate-200 shadow-2xl flex flex-col overflow-y-auto"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-200 flex justify-between items-start sticky top-0 bg-white/90 backdrop-blur-md z-10">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center text-purple-600 font-bold border border-purple-500/20">
                  {lead.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{lead.name}</h2>
                  <p className="text-sm text-slate-500">{lead.phone}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-[10px] font-bold uppercase tracking-wider">{lead.status}</span>
                {hasScore && score >= 80 && (
                  <span className="px-3 py-1 bg-orange-100 text-orange-600 border border-orange-200 rounded-full text-[10px] font-bold flex items-center gap-1">
                    <Flame className="w-3 h-3" /> Hot Lead
                  </span>
                )}
                {lead.qualificationStatus && (
                  <span className="px-3 py-1 bg-purple-100 text-purple-600 rounded-full text-[10px] font-bold">{lead.qualificationStatus}</span>
                )}
                {bookingEvidence && (
                  <span className="px-3 py-1 bg-green-100 text-green-700 border border-green-200 rounded-full text-[10px] font-bold flex items-center gap-1">
                    📅 Booking Interest
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          <div className="p-6 space-y-8">
            {/* AI Lead Score ring */}
            <div className={`flex items-center gap-5 border rounded-2xl p-5 ${hasScore ? scoreBg : 'bg-slate-50 border-slate-100'}`}>
              {hasScore ? (
                <ScoreRing score={score} />
              ) : (
                <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center text-slate-400 text-xs font-bold">N/A</div>
              )}
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">AI Lead Score</div>
                {hasScore ? (
                  <div className={`text-2xl font-black ${scoreColor}`}>{score}<span className="text-sm font-medium text-slate-400">/100</span></div>
                ) : (
                  <div className="text-sm text-slate-400 italic">Scoring in progress…</div>
                )}
                {lead.urgency && (
                  <div className="flex items-center gap-1 mt-1 text-xs font-semibold text-slate-500">
                    <Clock className="w-3 h-3" /> Urgency: {lead.urgency}
                  </div>
                )}
              </div>
            </div>

            {/* AI Insights Panel */}
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-100 rounded-2xl p-5 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <Lightbulb className="w-24 h-24 text-purple-600" />
              </div>
              <h3 className="text-sm font-bold text-purple-700 flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4" /> AI Lead Insights
              </h3>
              <p className="text-sm text-slate-700 leading-relaxed relative z-10">
                {lead.aiInsights || 'AI is analyzing this lead…'}
              </p>
            </div>

            {/* Extracted Intelligence */}
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Extracted Intelligence</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 mb-1">Business Type</div>
                  <div className="font-semibold text-sm text-slate-900">{lead.businessType || '—'}</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 mb-1">Budget</div>
                  <div className="font-semibold text-sm text-slate-900">{lead.budget || '—'}</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 mb-1">Urgency</div>
                  <div className="font-semibold text-sm text-slate-900 flex items-center gap-1">
                    {lead.urgency ? <Clock className="w-3 h-3 text-red-500" /> : null}
                    {lead.urgency || '—'}
                  </div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 mb-1">AI Lead Score</div>
                  <div className={`font-semibold text-sm flex items-center gap-2 ${hasScore ? scoreColor : 'text-slate-400'}`}>
                    <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden flex-1">
                      <div
                        className={`h-full ${score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-400'}`}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                    {hasScore ? score : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Interest */}
            {lead.interest && (
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Interest / Course</h3>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-800">{lead.interest}</div>
              </div>
            )}

            {/* Requirements & Summary */}
            {(lead.requirements || lead.aiSummary) && (
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Requirements & Summary</h3>
                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-4">
                  {lead.requirements && (
                    <div>
                      <div className="text-xs font-semibold mb-1 text-slate-900">Extracted Requirements:</div>
                      <p className="text-sm text-slate-600 leading-relaxed">{lead.requirements}</p>
                    </div>
                  )}
                  {lead.aiSummary && (
                    <div>
                      <div className="text-xs font-semibold mb-1 text-slate-900">AI Conversation Summary:</div>
                      <p className="text-sm text-slate-600 leading-relaxed">{lead.aiSummary}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Automation Status */}
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Automation Status</h3>
              <div className="bg-slate-50 rounded-2xl border border-slate-100 divide-y divide-slate-100">
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Activity className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-slate-700">Conversation Stage</span>
                  </div>
                  <span className="text-xs font-bold bg-slate-200 text-slate-700 px-2 py-1 rounded-md">{lead.conversationStage || 'N/A'}</span>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-slate-700">Next Follow-up</span>
                  </div>
                  <span className="text-xs font-bold text-slate-900">
                    {lead.nextFollowUpDate ? format(new Date(lead.nextFollowUpDate), 'MMM d, yyyy') : 'None Scheduled'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
