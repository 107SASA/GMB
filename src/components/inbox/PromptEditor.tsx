import React, { useState, useEffect } from 'react';

interface PromptEditorProps {
  businessId: string;
}

export default function PromptEditor({ businessId }: PromptEditorProps) {
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/inbox/config?businessId=${businessId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setConfig(d.config);
      });
  }, [businessId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/inbox/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          ...config
        })
      });
      // Optionally show toast
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!config) return <div className="p-4 text-sm text-slate-500">Loading AI Config...</div>;

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm max-w-2xl">
      <h3 className="text-lg font-bold text-slate-900 mb-6">AI Sales Agent Configuration</h3>
      
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">System Prompt</label>
          <textarea 
            value={config.systemPrompt}
            onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
            className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
            rows={4}
          />
          <p className="text-xs text-slate-500 mt-1">This forms the core personality and goal of the AI.</p>
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">Sales Rules & Restrictions</label>
          <textarea 
            value={config.salesRules}
            onChange={(e) => setConfig({ ...config, salesRules: e.target.value })}
            className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
            rows={3}
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">AI Tone</label>
          <input 
            type="text"
            value={config.aiTone}
            onChange={(e) => setConfig({ ...config, aiTone: e.target.value })}
            className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>

        <button 
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-slate-900 text-white font-bold rounded-xl text-sm hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}
