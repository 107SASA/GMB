import React from 'react';
import { User, Zap, CheckCircle, XCircle, Clock } from 'lucide-react';

const AI_EVENT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  content_generation: { label: 'Generated post content', color: 'text-primary', bg: 'bg-primary-fixed' },
  review_reply:       { label: 'Drafted review reply',   color: 'text-primary',   bg: 'bg-primary-fixed'   },
  lead_response:      { label: 'Responded to a lead',    color: 'text-secondary', bg: 'bg-secondary-container' },
  audit:              { label: 'Completed business audit', color: 'text-error', bg: 'bg-error-container'  },
  follow_up:          { label: 'Sent follow-up message', color: 'text-primary', bg: 'bg-primary-fixed'  },
  seo_content:        { label: 'Generated SEO content',  color: 'text-primary',   bg: 'bg-primary-fixed'   },
};

function relTime(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface QuickPanelsProps {
  panels: {
    recentLeads: any[];
    followUps: any[];
    aiActivities: {
      promptType: string;
      status: 'success' | 'failed' | 'partial';
      aiModel: string;
      tokensUsed: number;
      createdAt: string;
    }[];
  };
}

export default function QuickPanels({ panels }: QuickPanelsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* Recent Leads */}
      <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow">
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-primary-fixed rounded-lg">
              <User className="w-4 h-4 text-primary" />
            </div>
            <h3 className="font-bold text-on-surface">Recent Leads</h3>
          </div>
          <a href="/dashboard/crm" className="text-xs font-bold text-primary hover:text-primary transition-colors">
            View All →
          </a>
        </div>

        <div className="space-y-3">
          {panels.recentLeads.length === 0 ? (
            <div className="bg-surface border border-dashed border-outline-variant rounded-xl p-6 text-center">
              <p className="text-sm font-medium text-on-surface-variant mb-2">No leads captured yet.</p>
              <a href="/dashboard/crm" className="text-xs font-bold text-primary hover:text-primary">
                Setup Lead Generation →
              </a>
            </div>
          ) : (
            panels.recentLeads.map((lead: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl hover:bg-surface transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {lead.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-on-surface">{lead.name}</p>
                    <p className="text-xs text-outline">{lead.source}</p>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                  lead.pipelineStage === 'Converted'
                    ? 'bg-secondary-container text-on-secondary-container'
                    : lead.pipelineStage === 'New'
                    ? 'bg-primary-fixed text-primary'
                    : 'bg-surface-container text-on-surface-variant'
                }`}>
                  {lead.pipelineStage || 'New'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* AI Activity Feed */}
      <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow">
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-primary-fixed rounded-lg">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <h3 className="font-bold text-on-surface">AI Activity</h3>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-bold text-secondary bg-secondary-container/40 px-2 py-1 rounded-full">
            <span className="w-1.5 h-1.5 bg-secondary rounded-full animate-pulse" />
            Live
          </span>
        </div>

        <div className="space-y-2">
          {panels.aiActivities.length === 0 ? (
            <div className="bg-surface border border-dashed border-outline-variant rounded-xl p-6 text-center">
              <p className="text-sm font-medium text-on-surface-variant mb-1">No AI activity yet.</p>
              <p className="text-xs text-outline">Activity will appear as the AI works for your business.</p>
            </div>
          ) : (
            panels.aiActivities.map((act, i) => {
              const meta = AI_EVENT_MAP[act.promptType] ?? {
                label: act.promptType?.replace(/_/g, ' ') ?? 'AI task',
                color: 'text-on-surface-variant',
                bg: 'bg-surface-container',
              };
              return (
                <div key={i} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-surface transition-colors group">
                  <div className={`p-1.5 rounded-lg ${meta.bg} shrink-0 mt-0.5`}>
                    {act.status === 'failed'
                      ? <XCircle className="w-3.5 h-3.5 text-error" />
                      : act.status === 'partial'
                      ? <Clock className="w-3.5 h-3.5 text-error" />
                      : <CheckCircle className={`w-3.5 h-3.5 ${meta.color}`} />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-on-surface">
                      AI {meta.label}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-outline">{relTime(act.createdAt)}</span>
                      {act.tokensUsed > 0 && (
                        <span className="text-[10px] text-outline">{act.tokensUsed.toLocaleString()} tokens</span>
                      )}
                    </div>
                  </div>
                  {act.status === 'failed' && (
                    <span className="text-[10px] font-bold text-error bg-error-container px-1.5 py-0.5 rounded shrink-0">failed</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}
