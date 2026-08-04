import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { Phone, MessageSquare, Mail, FileText, Calendar } from 'lucide-react';

type ActivityType = 'call' | 'WhatsApp' | 'email' | 'note' | 'meeting';

const ACTIVITY_TYPES: { type: ActivityType; label: string; icon: ReactNode; color: string }[] = [
  { type: 'call',     label: 'Call',     icon: <Phone className="w-4 h-4" />,         color: 'text-secondary bg-secondary-container/40 border-secondary-fixed data-[active=true]:bg-secondary data-[active=true]:text-white data-[active=true]:border-secondary' },
  { type: 'WhatsApp', label: 'WhatsApp', icon: <MessageSquare className="w-4 h-4" />, color: 'text-secondary bg-secondary-container/40 border-secondary-fixed data-[active=true]:bg-whatsapp data-[active=true]:text-white data-[active=true]:border-whatsapp' },
  { type: 'email',    label: 'Email',    icon: <Mail className="w-4 h-4" />,          color: 'text-primary bg-primary-fixed border-primary-fixed-dim data-[active=true]:bg-primary data-[active=true]:text-white data-[active=true]:border-primary' },
  { type: 'note',     label: 'Note',     icon: <FileText className="w-4 h-4" />,      color: 'text-on-surface-variant bg-surface border-outline-variant data-[active=true]:bg-on-surface data-[active=true]:text-white data-[active=true]:border-on-surface' },
  { type: 'meeting',  label: 'Meeting',  icon: <Calendar className="w-4 h-4" />,      color: 'text-primary bg-primary-fixed border-primary-fixed-dim data-[active=true]:bg-primary data-[active=true]:text-white data-[active=true]:border-primary' },
];

const TYPE_DOT: Record<string, string> = {
  call: 'bg-secondary', WhatsApp: 'bg-whatsapp', email: 'bg-primary',
  note: 'bg-outline', meeting: 'bg-primary', status_change: 'bg-error',
  followUp: 'bg-primary',
};

interface ActivityTimelineProps {
  leadId: string;
  onActivityLogged?: (activity: any) => void;
}

export default function ActivityTimeline({ leadId, onActivityLogged }: ActivityTimelineProps) {
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<ActivityType>('note');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [logError, setLogError] = useState('');

  const fetchTimeline = useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/timeline`);
      const data = await res.json();
      if (data.success) setTimeline(data.timeline);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { fetchTimeline(); }, [fetchTimeline]);

  const handleLog = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    setLogError('');
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: selectedType, content: content.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const optimistic = {
          ...data.activity,
          timelineType: 'activity',
          date: data.activity.createdAt || new Date().toISOString(),
        };
        setTimeline(prev => [optimistic, ...prev]);
        setContent('');
        onActivityLogged?.(data.activity);
      } else {
        const msg = data.error || data.message || `Error ${res.status}`;
        setLogError(msg);
        console.error('[ActivityTimeline] log failed:', res.status, data);
      }
    } catch (e: any) {
      setLogError('Network error — check console');
      console.error('[ActivityTimeline] network error:', e);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-4 text-center text-sm text-on-surface-variant">Loading timeline...</div>;

  return (
    <div className="flex flex-col gap-6">
      {/* Log Activity Form */}
      <div className="bg-surface rounded-2xl border border-outline-variant p-4">
        <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-3">Log Activity</p>

        {/* Type selector */}
        <div className="flex flex-wrap gap-2 mb-3">
          {ACTIVITY_TYPES.map(({ type, label, icon, color }) => (
            <button
              key={type}
              data-active={selectedType === type}
              onClick={() => setSelectedType(type)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${color}`}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        <textarea
          rows={3}
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={`What happened on this ${selectedType}?`}
          className="w-full text-sm px-3 py-2.5 rounded-xl border border-outline-variant focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none mb-3"
        />

        <div className="flex items-center justify-between gap-3">
          {logError ? (
            <p className="text-xs text-error bg-error-container border border-error-container rounded-lg px-3 py-1.5 flex-1">
              {logError}
            </p>
          ) : (
            <span />
          )}
          <button
            onClick={handleLog}
            disabled={!content.trim() || submitting}
            className="px-4 py-2 bg-primary hover:bg-primary disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors shrink-0"
          >
            {submitting ? 'Logging…' : 'Log'}
          </button>
        </div>
      </div>

      {/* Timeline */}
      {timeline.length === 0 ? (
        <p className="text-outline text-sm text-center py-6">No activity yet.</p>
      ) : (
        <div className="relative border-l-2 border-outline-variant ml-3 space-y-8 pb-10">
          {timeline.map((item, idx) => (
            <div key={idx} className="relative pl-6">
              <div className={`absolute w-3 h-3 rounded-full -left-1.75 top-1.5 border-2 border-white ${TYPE_DOT[item.type] || TYPE_DOT[item.timelineType] || 'bg-surface-container-highest'}`} />
              <div className="text-xs font-bold text-outline mb-1">
                {new Date(item.date).toLocaleString()}
              </div>
              <div className="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant shadow-sm">
                {item.timelineType === 'followUp' ? (
                  <p className="text-sm text-on-surface">
                    <strong>Follow-Up:</strong> {item.messageTemplate || 'Reminder'}{' '}
                    <span className="uppercase text-xs font-bold text-error">{item.status}</span>
                  </p>
                ) : (
                  <p className="text-sm text-on-surface">
                    <span className="uppercase text-xs font-bold text-primary mr-2">[{item.type}]</span>
                    {item.content}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
