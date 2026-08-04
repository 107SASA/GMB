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
  initial:   { bg: 'bg-surface-container text-on-surface-variant',     dot: 'bg-outline',    label: 'Initial' },
  active:    { bg: 'bg-primary-fixed text-primary',       dot: 'bg-primary',     label: 'Active' },
  closed:    { bg: 'bg-error-container text-on-error-container',       dot: 'bg-error',     label: 'Closed' },
  converted: { bg: 'bg-secondary-container text-on-secondary-container', dot: 'bg-secondary',  label: 'Converted' },
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
          className="absolute inset-0 bg-primary/20 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="relative w-full max-w-md bg-surface-container-lowest h-full card-shadow flex flex-col border-l border-outline-variant"
        >
          {/* Header */}
          <div className="p-6 border-b border-outline-variant flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <StageBadge stage={lead.lifeCycleStage} />
                {lead.subStage && (
                  <span className="text-xs font-semibold px-2 py-0.5 bg-primary-fixed text-primary rounded-full border border-primary-fixed-dim">{lead.subStage}</span>
                )}
                {lead.pipelineStage && (
                  <span className="text-xs font-bold px-2 py-0.5 bg-primary-fixed text-primary rounded border border-primary-fixed-dim uppercase">{lead.pipelineStage}</span>
                )}
                <span className="text-xs font-bold px-2 py-0.5 bg-primary-fixed text-primary rounded uppercase">AI Score: {lead.aiLeadScore || 'N/A'}</span>
              </div>
              <h2 className="text-2xl font-black text-on-surface">{lead.name}</h2>
              <p className="text-sm text-on-surface-variant mt-1">{lead.phone || lead.email || 'No contact info'}</p>
            </div>
            <button onClick={onClose} className="p-2 bg-surface-container hover:bg-surface-container-high rounded-full text-on-surface-variant transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6">

            {lead.aiInsights && (
              <div className="mb-8 p-4 bg-primary-fixed border border-primary-fixed-dim rounded-2xl">
                <h3 className="text-xs font-bold text-primary uppercase tracking-wider mb-2 flex items-center gap-2">
                  <span>✨ AI Insights</span>
                </h3>
                <p className="text-sm text-primary leading-relaxed">{lead.aiInsights}</p>
              </div>
            )}

            {/* Life Cycle Stage Selector */}
            <div className="mb-8 p-4 bg-surface border border-outline-variant rounded-2xl">
              <h3 className="text-xs font-bold text-on-surface uppercase tracking-wider mb-3">Life Cycle Stage</h3>
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
                          : 'bg-surface-container-lowest border-outline-variant text-on-surface-variant hover:border-outline-variant hover:text-on-surface'
                      } disabled:opacity-50`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? s.dot : 'bg-surface-container-highest'}`} />
                      {s.label}
                    </button>
                  );
                })}
              </div>

              {/* Sub-stage picker — options come from the business's Lead Stages config */}
              {subStageOptions.length > 0 && (
                <div className="mt-4 pt-4 border-t border-outline-variant">
                  <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Sub-stage</h4>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      disabled={updatingStage}
                      onClick={() => handleSubStageChange(null)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all disabled:opacity-50 ${
                        !lead.subStage
                          ? 'bg-surface-container-high border-outline-variant text-on-surface'
                          : 'bg-surface-container-lowest border-outline-variant text-outline hover:border-outline-variant hover:text-on-surface-variant'
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
                              ? 'bg-primary-fixed border-primary-fixed-dim text-primary shadow-sm'
                              : 'bg-surface-container-lowest border-outline-variant text-on-surface-variant hover:border-primary-fixed-dim hover:text-primary'
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
              <h3 className="text-sm font-bold text-on-surface mb-4">Lead Details</h3>
              <div className="bg-surface rounded-2xl p-4 border border-outline-variant space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Source</span>
                  <span className="font-medium text-on-surface">{lead.source}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Interest</span>
                  <span className="font-medium text-on-surface">{lead.interest || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Created</span>
                  <span className="font-medium text-on-surface">{new Date(lead.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Status</span>
                  <span className="font-medium text-on-surface capitalize">{lead.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Assigned To</span>
                  <span className="font-medium text-on-surface">{lead.assignedUserId ? 'Assigned' : 'Unassigned'}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-on-surface mb-4">Activity Timeline</h3>
              <ActivityTimeline leadId={lead._id} />
            </div>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
