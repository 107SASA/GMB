import React, { useState, useEffect } from 'react';
import { useBusiness } from '@/context/BusinessContext';

export default function PromptEditor() {
  const { activeBusiness } = useBusiness();
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!activeBusiness?._id) return;
    // Route is cookie-auth'd; passing businessId as a hint for clarity only
    fetch(`/api/inbox/config?businessId=${activeBusiness._id}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setConfig(d.config);
      });
  }, [activeBusiness?._id]);

  const handleSave = async () => {
    if (!activeBusiness?._id) return;
    setSaving(true);
    try {
      await fetch('/api/inbox/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: activeBusiness._id,
          ...config,
        }),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!activeBusiness) return <div className="p-4 text-sm text-on-surface-variant">Loading workspace...</div>;
  if (!config) return <div className="p-4 text-sm text-on-surface-variant">Loading AI Config...</div>;

  return (
    <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow max-w-2xl">
      <h3 className="text-lg font-bold text-on-surface mb-6">AI Sales Agent Configuration</h3>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-bold text-on-surface mb-2">System Prompt</label>
          <textarea
            value={config.systemPrompt}
            onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
            className="w-full text-sm p-3 border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary outline-none"
            rows={4}
          />
          <p className="text-xs text-on-surface-variant mt-1">This forms the core personality and goal of the AI.</p>
        </div>

        <div>
          <label className="block text-sm font-bold text-on-surface mb-2">Sales Rules & Restrictions</label>
          <textarea
            value={config.salesRules}
            onChange={(e) => setConfig({ ...config, salesRules: e.target.value })}
            className="w-full text-sm p-3 border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary outline-none"
            rows={3}
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-on-surface mb-2">AI Tone</label>
          <input
            type="text"
            value={config.aiTone}
            onChange={(e) => setConfig({ ...config, aiTone: e.target.value })}
            className="w-full text-sm p-3 border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary outline-none"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-primary text-white font-bold rounded-xl text-sm hover:bg-primary transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}
