import React, { useEffect, useState } from 'react';

interface ActivityTimelineProps {
  leadId: string;
}

export default function ActivityTimeline({ leadId }: ActivityTimelineProps) {
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');

  const fetchTimeline = async () => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/timeline`);
      const data = await res.json();
      if (data.success) {
        setTimeline(data.timeline);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTimeline();
  }, [leadId]);

  const handleAddNote = async () => {
    if (!note.trim()) return;
    try {
      await fetch(`/api/crm/leads/${leadId}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'note', content: note })
      });
      setNote('');
      fetchTimeline();
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) return <div className="p-4 text-center text-sm text-slate-500">Loading timeline...</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
        <textarea 
          className="w-full text-sm p-3 rounded-lg border border-slate-200 mb-2 focus:ring-2 focus:ring-indigo-500 outline-none"
          rows={3}
          placeholder="Add a manual note..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex justify-end">
          <button 
            onClick={handleAddNote}
            className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-800"
          >
            Save Note
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-6">
        {timeline.length === 0 ? (
          <p className="text-slate-500 text-sm text-center">No activity yet.</p>
        ) : (
          <div className="relative border-l-2 border-slate-200 ml-3 space-y-8 pb-10">
            {timeline.map((item, idx) => (
              <div key={idx} className="relative pl-6">
                <div className="absolute w-3 h-3 bg-slate-300 rounded-full -left-[7px] top-1.5 border-2 border-white"></div>
                <div className="text-xs font-bold text-slate-400 mb-1">
                  {new Date(item.date).toLocaleString()}
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                  {item.timelineType === 'followUp' ? (
                    <p className="text-sm text-slate-800">
                      <strong>Follow-Up:</strong> {item.messageTemplate || 'Reminder'} - <span className="uppercase text-xs font-bold text-amber-600">{item.status}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-slate-800">
                      <span className="uppercase text-xs font-bold text-indigo-600 mr-2">[{item.type}]</span>
                      {item.content}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
