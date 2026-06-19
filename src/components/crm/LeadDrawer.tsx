import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ActivityTimeline from './ActivityTimeline';

interface LeadDrawerProps {
  lead: any;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export default function LeadDrawer({ lead, isOpen, onClose, onUpdate }: LeadDrawerProps) {
  if (!isOpen || !lead) return null;

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
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold px-2 py-0.5 bg-slate-100 text-slate-600 rounded uppercase">{lead.pipelineStage}</span>
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

            <div className="mb-8">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Lead Details</h3>
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Source</span>
                  <span className="font-medium text-slate-900">{lead.source}</span>
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

            <div className="h-[400px]">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Activity Timeline</h3>
              <ActivityTimeline leadId={lead._id} />
            </div>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
