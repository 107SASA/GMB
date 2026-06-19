import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Flame, Clock, Calendar, CheckCircle, Lightbulb, Activity, Zap } from 'lucide-react';
import { format } from 'date-fns';

export default function LeadDetailsDrawer({ lead, onClose }: any) {
  if (!lead) return null;

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
                {lead.intentScore >= 80 && (
                  <span className="px-3 py-1 bg-orange-100 text-orange-600 border border-orange-200 rounded-full text-[10px] font-bold flex items-center gap-1">
                    <Flame className="w-3 h-3" /> Hot Lead
                  </span>
                )}
                {lead.qualificationStatus && (
                  <span className="px-3 py-1 bg-purple-100 text-purple-600 rounded-full text-[10px] font-bold">{lead.qualificationStatus}</span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          <div className="p-6 space-y-8">
            {/* AI Insights Panel */}
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-100 rounded-2xl p-5 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <Lightbulb className="w-24 h-24 text-purple-600" />
              </div>
              <h3 className="text-sm font-bold text-purple-700 flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4" /> AI Lead Insights
              </h3>
              
              <div className="space-y-4 relative z-10">
                {lead.intentScore >= 80 && (
                  <div className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="text-orange-500">🔥</span> "Lead shows extremely strong buying intent. Highly recommended for immediate demo scheduling."
                  </div>
                )}
                {lead.urgency === 'High' || lead.urgency === 'Urgent' ? (
                  <div className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="text-red-500">⏱️</span> "Urgent requirement detected. Prioritize follow-up."
                  </div>
                ) : null}
                {lead.bookingInterested && (
                  <div className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="text-green-500">📅</span> "Lead expressed direct interest in booking a call."
                  </div>
                )}
                {!lead.intentScore && !lead.urgency && !lead.bookingInterested && (
                  <div className="text-sm text-slate-500 italic">AI is currently analyzing this conversation to generate insights.</div>
                )}
              </div>
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
                  <div className="text-[10px] text-slate-400 mb-1">Intent Score</div>
                  <div className="font-semibold text-sm text-slate-900 flex items-center gap-2">
                    <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden flex-1">
                      <div 
                        className={`h-full ${lead.intentScore >= 80 ? 'bg-orange-500' : lead.intentScore >= 50 ? 'bg-blue-500' : 'bg-slate-300'}`} 
                        style={{ width: `${lead.intentScore || 0}%` }} 
                      />
                    </div>
                    {lead.intentScore || 0}
                  </div>
                </div>
              </div>
            </div>

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
                  <span className="text-xs font-bold text-slate-900">{lead.nextFollowUpDate ? format(new Date(lead.nextFollowUpDate), 'MMM d, yyyy') : 'None Scheduled'}</span>
                </div>
              </div>
            </div>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
