'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ActivityTimeline from './ActivityTimeline';
import type { LeadStagesConfig, SubStageGroup } from '@/lib/leadStages';

interface LeadDrawerProps {
  lead: any;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

const STAGE_STYLES: Record<string, { bg: string; dot: string; label: string }> = {
  initial:   { bg: 'bg-slate-100 text-slate-600',     dot: 'bg-slate-400',    label: 'Initial' },
  active:    { bg: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500',     label: 'Active' },
  closed:    { bg: 'bg-rose-100 text-rose-700',       dot: 'bg-rose-500',     label: 'Closed' },
  converted: { bg: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500',  label: 'Converted' },
};

function StageBadge({ stage }: { stage?: string }) {
  const s = STAGE_STYLES[stage || 'initial'] ?? STAGE_STYLES.initial;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${s.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  );
}

export default function LeadDrawer({ lead, isOpen, onClose, onUpdate }: LeadDrawerProps) {
  const [updatingStage, setUpdatingStage] = useState(false);
  const [stagesConfig, setStagesConfig] = useState<LeadStagesConfig | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const res = await fetch('/api/business/lead-stages');
        const data = await res.json();
        if (data.success) setStagesConfig(data.leadStages);
      } catch { /* sub-stage picker just stays hidden */ }
    })();
  }, [isOpen]);

  if (!isOpen || !lead) return null;

  const handleStageChange = async (newStage: string) => {
    setUpdatingStage(true);
    try {
      await fetch(`/api/crm/leads/${lead._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // A stage move invalidates the previous sub-stage
        body: JSON.stringify({ lifeCycleStage: newStage, subStage: null }),
      });
      lead.lifeCycleStage = newStage;
      lead.subStage = null;
      onUpdate();
    } finally {
      setUpdatingStage(false);
    }
  };

  const handleSubStageChange = async (newSubStage: string | null) => {
    setUpdatingStage(true);
    try {
      await fetch(`/api/crm/leads/${lead._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subStage: newSubStage }),
      });
      lead.subStage = newSubStage;
      onUpdate();
    } finally {
      setUpdatingStage(false);
    }
  };

  const currentStage: string = lead.lifeCycleStage || 'initial';
  const subStageOptions =
    stagesConfig && currentStage !== 'initial'
      ? stagesConfig[currentStage as SubStageGroup] ?? []
      : [];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex justify-end">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col border-l border-slate-200"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-100 flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <StageBadge stage={lead.lifeCycleStage} />
                {lead.subStage && (
                  <span className="text-xs font-semibold px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full border border-violet-100">{lead.subStage}</span>
                )}
                {lead.pipelineStage && (
                  <span className="text-xs font-bold px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-100 uppercase">{lead.pipelineStage}</span>
                )}
                <span className="text-xs font-bold px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded uppercase">AI Score: {lead.aiLeadScore || 'N/A'}</span>
              </div>
              <h2 className="text-2xl font-black text-slate-900">{lead.name}</h2>
              <p className="text-sm text-slate-500 mt-1">{lead.phone || lead.email || 'No contact info'}</p>
            </div>
            <button onClick={onClose} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6">

            {lead.aiInsights && (
              <div className="mb-8 p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
                <h3 className="text-xs font-bold text-indigo-800 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <span>✨ AI Insights</span>
                </h3>
                <p className="text-sm text-indigo-900 leading-relaxed">{lead.aiInsights}</p>
              </div>
            )}

            {/* Life Cycle Stage Selector */}
            <div className="mb-8 p-4 bg-slate-50 border border-slate-100 rounded-2xl">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">Life Cycle Stage</h3>
              <div className="grid grid-cols-2 gap-2">
                {(['initial', 'active', 'closed', 'converted'] as const).map((stage) => {
                  const s = STAGE_STYLES[stage];
                  const isActive = (lead.lifeCycleStage || 'initial') === stage;
                  return (
                    <button
                      key={stage}
                      disabled={updatingStage}
                      onClick={() => handleStageChange(stage)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        isActive
                          ? `${s.bg} border-current shadow-sm`
                          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
                      } disabled:opacity-50`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? s.dot : 'bg-slate-300'}`} />
                      {s.label}
                    </button>
                  );
                })}
              </div>

              {/* Sub-stage picker — options come from the business's Lead Stages config */}
              {subStageOptions.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Sub-stage</h4>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      disabled={updatingStage}
                      onClick={() => handleSubStageChange(null)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all disabled:opacity-50 ${
                        !lead.subStage
                          ? 'bg-slate-200 border-slate-300 text-slate-700'
                          : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
                      }`}
                    >
                      None
                    </button>
                    {subStageOptions.map((sub) => {
                      const isSelected = lead.subStage === sub.name;
                      return (
                        <button
                          key={sub.name}
                          disabled={updatingStage}
                          onClick={() => handleSubStageChange(sub.name)}
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all disabled:opacity-50 ${
                            isSelected
                              ? 'bg-violet-100 border-violet-300 text-violet-700 shadow-sm'
                              : 'bg-white border-slate-200 text-slate-500 hover:border-violet-200 hover:text-violet-600'
                          }`}
                        >
                          {sub.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="mb-8">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Lead Details</h3>
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Source</span>
                  <span className="font-medium text-slate-900">{lead.source}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Interest</span>
                  <span className="font-medium text-slate-900">{lead.interest || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Created</span>
                  <span className="font-medium text-slate-900">{new Date(lead.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status</span>
                  <span className="font-medium text-slate-900 capitalize">{lead.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Assigned To</span>
                  <span className="font-medium text-slate-900">{lead.assignedUserId ? 'Assigned' : 'Unassigned'}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-4">Activity Timeline</h3>
              <ActivityTimeline leadId={lead._id} />
            </div>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
