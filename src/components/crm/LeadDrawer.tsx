'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, MessageCircle } from 'lucide-react';
import ActivityTimeline from './ActivityTimeline';
import ChatModal from './ChatModal';
import DealValueModal, { type DealValue } from './DealValueModal';
import FollowUpTasks from './FollowUpTasks';
import { telHref } from '@/lib/phoneLinks';
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
  const [showChat, setShowChat] = useState(false);
  // 'win' = moving to Converted (deal value required); 'edit' = record/edit the value.
  const [dealPrompt, setDealPrompt] = useState<null | { mode: 'win' | 'edit' }>(null);
  const [stageError, setStageError] = useState('');

  // Close the chat modal whenever the drawer switches to another lead / closes
  useEffect(() => { setShowChat(false); setDealPrompt(null); setStageError(''); }, [lead?._id, isOpen]);

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

  /** PATCH a stage / deal change; returns an error message or null. */
  const patchLead = async (body: Record<string, unknown>): Promise<string | null> => {
    setUpdatingStage(true);
    setStageError('');
    try {
      const res = await fetch(`/api/crm/leads/${lead._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error || 'Could not update this lead.';
      if (data.lead) Object.assign(lead, data.lead);
      onUpdate();
      return null;
    } catch {
      return 'Network error — nothing was changed.';
    } finally {
      setUpdatingStage(false);
    }
  };

  const handleStageChange = async (newStage: string) => {
    if ((lead.lifeCycleStage || 'initial') === newStage) return;
    // Won needs the deal value first.
    if (newStage === 'converted' && typeof lead.deal?.value !== 'number') { setDealPrompt({ mode: 'win' }); return; }
    // A stage move invalidates the previous sub-stage
    const err = await patchLead({ lifeCycleStage: newStage, subStageId: null, subStage: null });
    if (err) setStageError(err);
  };

  const handleSubStageChange = async (sub: { id?: string; name: string } | null) => {
    const err = await patchLead({ lifeCycleStage: lead.lifeCycleStage || 'initial', subStageId: sub?.id ?? null, subStage: sub?.name ?? null });
    if (err) setStageError(err);
  };

  const handleDeal = async (deal: DealValue) => {
    const body = dealPrompt?.mode === 'win'
      ? { lifeCycleStage: 'converted', subStageId: stagesConfig?.converted?.[0]?.id ?? null, subStage: stagesConfig?.converted?.[0]?.name ?? null, deal }
      : { deal };
    const err = await patchLead(body);
    if (!err) setDealPrompt(null);
    return err;
  };

  const fmtMoney = (v: number, c?: string) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: c || 'INR', maximumFractionDigits: 0 }).format(v);

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
              </div>
              <h2 className="text-2xl font-black text-on-surface">{lead.name}</h2>
              <p className="text-sm text-on-surface-variant mt-1">{lead.phone || lead.email || 'No contact info'}</p>

              {lead.phone && (
                <div className="flex items-center gap-2 mt-3">
                  <a
                    href={telHref(lead.phone) ?? undefined}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant text-xs font-semibold text-on-surface transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Call
                  </a>
                  <button
                    onClick={() => setShowChat(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary-container/50 hover:bg-secondary-container border border-secondary-fixed text-xs font-semibold text-on-secondary-container transition-colors"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    WhatsApp
                  </button>
                </div>
              )}
            </div>
            <button onClick={onClose} className="p-2 bg-surface-container hover:bg-surface-container-high rounded-full text-on-surface-variant transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6">

            {lead.lifeCycleStage === 'converted' && (
              <div className="mb-8 p-4 bg-secondary-container/40 border border-secondary-fixed rounded-2xl flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold text-on-secondary-container uppercase tracking-wider mb-1">Deal value</h3>
                  {typeof lead.deal?.value === 'number' ? (
                    <p className="text-lg font-black text-on-surface">
                      {fmtMoney(lead.deal.value, lead.deal.currency)}
                      {lead.deal.closedAt && <span className="text-xs font-medium text-on-surface-variant ml-2">closed {new Date(lead.deal.closedAt).toLocaleDateString('en-IN')}</span>}
                    </p>
                  ) : (
                    <p className="text-sm text-error font-semibold">Not recorded — not counted in revenue.</p>
                  )}
                  {lead.deal?.notes && <p className="text-xs text-on-surface-variant mt-1">{lead.deal.notes}</p>}
                </div>
                <button onClick={() => setDealPrompt({ mode: 'edit' })} className="px-3 py-1.5 text-xs font-bold bg-surface-container-lowest border border-outline-variant rounded-lg shrink-0">
                  {typeof lead.deal?.value === 'number' ? 'Edit' : 'Add value'}
                </button>
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
                      const isSelected = lead.subStageId ? lead.subStageId === sub.id : lead.subStage === sub.name;
                      return (
                        <button
                          key={sub.id ?? sub.name}
                          disabled={updatingStage}
                          onClick={() => handleSubStageChange(sub)}
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
              {stageError && <p className="mt-3 text-xs text-error">{stageError}</p>}
            </div>

            <FollowUpTasks leadId={lead._id} onChanged={onUpdate} />

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

        {showChat && <ChatModal lead={lead} onClose={() => setShowChat(false)} />}
        {dealPrompt && (
          <DealValueModal
            leadName={lead.name}
            initial={lead.deal?.value != null ? { value: lead.deal.value, currency: lead.deal.currency, closedAt: lead.deal.closedAt, notes: lead.deal.notes } : null}
            onCancel={() => setDealPrompt(null)}
            onConfirm={handleDeal}
          />
        )}
      </div>
    </AnimatePresence>
  );
}
