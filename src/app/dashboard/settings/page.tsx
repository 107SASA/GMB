'use client';

import { useState, useEffect, useRef } from 'react';
import { useBusiness } from '@/context/BusinessContext';
import {
  Building2,
  Bot,
  Bell,
  Plug,
  Tag,
  X,
  CheckCircle2,
  AlertCircle,
  Info,
} from 'lucide-react';

type Tab = 'business' | 'ai-agent' | 'notifications' | 'integrations';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'business', label: 'Business Profile', icon: Building2 },
  { id: 'ai-agent', label: 'AI Agent', icon: Bot },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'integrations', label: 'Integrations', icon: Plug },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SaveButton({ state, onSave }: { state: SaveState; onSave: () => void }) {
  return (
    <button
      onClick={onSave}
      disabled={state === 'saving'}
      className="px-6 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-60 text-white rounded-xl font-semibold text-sm transition-all flex items-center gap-2"
    >
      {state === 'saving' && (
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      )}
      {state === 'saving' ? 'Saving…' : state === 'saved' ? '✓ Saved' : 'Save Changes'}
    </button>
  );
}

function inputCls(extra = '') {
  return `w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white ${extra}`;
}

function LabelRow({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="block text-xs font-semibold text-slate-500">{label}</label>
      {hint && (
        <div className="relative group cursor-pointer">
          <Info className="w-3.5 h-3.5 text-slate-400" />
          <div className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-slate-800 text-white text-xs rounded-lg px-3 py-2 w-64 leading-relaxed shadow-xl">
            {hint}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI preview text
// ---------------------------------------------------------------------------

function getAIPreview(personality: string, tone: string, businessName: string): string {
  const name = businessName || 'your business';
  if (personality === 'Professional' && tone === 'Formal')
    return `Hello! Thank you for reaching out to ${name}. I'm here to assist you with any questions about our services.`;
  if (personality === 'Professional' && tone === 'Conversational')
    return `Hi there! Thanks for contacting ${name}. How can I help you today?`;
  if (personality === 'Professional' && tone === 'Casual')
    return `Hey! Thanks for reaching out to ${name}. What can I do for you?`;
  if (personality === 'Friendly' && tone === 'Formal')
    return `Good day! We at ${name} are delighted to hear from you. How may I be of assistance?`;
  if (personality === 'Friendly' && tone === 'Conversational')
    return `Hey there! 👋 Thanks for messaging ${name}! How can I help you today?`;
  if (personality === 'Friendly' && tone === 'Casual')
    return `Hey! 😊 So happy you reached out to ${name}! What's up?`;
  if (personality === 'Enthusiastic' && tone === 'Formal')
    return `Welcome! We at ${name} are thrilled to connect with you. How may I assist you today?`;
  if (personality === 'Enthusiastic' && tone === 'Conversational')
    return `Hi! 🎉 Awesome to hear from you! I'm the AI assistant for ${name} — what can I help with?`;
  if (personality === 'Enthusiastic' && tone === 'Casual')
    return `Hey hey! 🚀 Amazing that you reached out to ${name}! What's on your mind?`;
  return `Hello! Thank you for reaching out to ${name}.`;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('business');
  const { activeBusiness } = useBusiness();

  // ── Business Profile state ──────────────────────────────────────────────
  const [bpForm, setBpForm] = useState({
    name: '',
    category: '',
    description: '',
    phone: '',
    website: '',
    address: '',
    googleMapsUrl: '',
    placeId: '',
    whatsappNumber: '',
  });
  const [bpKeywords, setBpKeywords] = useState<string[]>([]);
  const [bpKeywordInput, setBpKeywordInput] = useState('');
  const [bpDescLen, setBpDescLen] = useState(0);
  const [bpSaveState, setBpSaveState] = useState<SaveState>('idle');
  const [bpError, setBpError] = useState('');
  const [bpLoaded, setBpLoaded] = useState(false);

  // ── AI Agent state ──────────────────────────────────────────────────────
  const [aiForm, setAiForm] = useState({
    aiPersonality: 'Professional',
    tone: 'Formal',
    maxResponseLength: 100,
    systemPrompt: '',
    salesRules: '',
    aiEnabled: true,
    businessId: '',
  });
  const [aiSaveState, setAiSaveState] = useState<SaveState>('idle');
  const [aiError, setAiError] = useState('');

  // ── Notifications state ─────────────────────────────────────────────────
  const [notifPrefs, setNotifPrefs] = useState({
    newLeadWhatsApp: true,
    newLeadEmail: true,
    newReviewEmail: true,
    criticalReviewWhatsApp: true,
    weeklyDigestEmail: true,
    campaignCompletedEmail: true,
    schedulerLowBufferEmail: true,
  });
  const [savedRows, setSavedRows] = useState<Set<string>>(new Set());

  // ── Integrations state ──────────────────────────────────────────────────
  const [integStatus, setIntegStatus] = useState<{
    serpapi: boolean;
    twilio: boolean;
    groq: boolean;
    googlePlaces: boolean;
  } | null>(null);

  // ── Load all data on mount ──────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const [bRes, aiRes, notifRes, integRes] = await Promise.all([
          fetch('/api/business'),
          fetch('/api/inbox/config'),
          fetch('/api/user/notifications'),
          fetch('/api/integrations/status'),
        ]);

        if (bRes.ok) {
          const b = await bRes.json();
          setBpForm({
            name: b.name ?? '',
            category: b.category ?? '',
            description: b.description ?? '',
            phone: b.phone ?? '',
            website: b.website ?? '',
            address: b.address ?? '',
            googleMapsUrl: b.googleMapsUrl ?? '',
            placeId: b.placeId ?? '',
            whatsappNumber: b.integrations?.whatsappNumber ?? '',
          });
          setBpKeywords(b.keywords ?? []);
          setBpDescLen((b.description ?? '').length);
          setBpLoaded(true);
        }

        if (aiRes.ok) {
          const { config } = await aiRes.json();
          setAiForm({
            aiPersonality: config.aiPersonality ?? 'Professional',
            tone: config.tone ?? 'Formal',
            maxResponseLength: config.maxResponseLength ?? 100,
            systemPrompt: config.systemPrompt ?? '',
            salesRules: config.salesRules ?? '',
            aiEnabled: config.aiEnabled ?? true,
            businessId: config.businessId ?? '',
          });
        }

        if (notifRes.ok) {
          const { preferences } = await notifRes.json();
          setNotifPrefs(preferences);
        }

        if (integRes.ok) {
          const data = await integRes.json();
          setIntegStatus(data);
        }
      } catch (err) {
        console.error('Settings load error:', err);
      }
    };
    load();
  }, []);

  // ── Business Profile save ───────────────────────────────────────────────
  const handleBpSave = async () => {
    if (!activeBusiness?._id) return;
    setBpSaveState('saving');
    setBpError('');
    try {
      const res = await fetch(`/api/business/${activeBusiness._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: bpForm.name,
          category: bpForm.category,
          description: bpForm.description,
          phone: bpForm.phone,
          website: bpForm.website,
          address: bpForm.address,
          googleMapsUrl: bpForm.googleMapsUrl,
          placeId: bpForm.placeId,
          keywords: bpKeywords,
          'integrations.whatsappNumber': bpForm.whatsappNumber,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setBpError(data.error || 'Save failed.'); setBpSaveState('error'); return; }
      setBpSaveState('saved');
      setTimeout(() => setBpSaveState('idle'), 2000);
    } catch {
      setBpError('Network error. Please try again.');
      setBpSaveState('error');
    }
  };

  // ── AI Agent save ───────────────────────────────────────────────────────
  const handleAiSave = async () => {
    setAiSaveState('saving');
    setAiError('');
    try {
      const res = await fetch('/api/inbox/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: aiForm.businessId,
          systemPrompt: aiForm.systemPrompt,
          aiTone: `${aiForm.aiPersonality} / ${aiForm.tone}`,
          salesRules: aiForm.salesRules,
          aiEnabled: aiForm.aiEnabled,
          aiPersonality: aiForm.aiPersonality,
          tone: aiForm.tone,
          maxResponseLength: aiForm.maxResponseLength,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setAiError(data.error || 'Save failed.'); setAiSaveState('error'); return; }
      setAiSaveState('saved');
      setTimeout(() => setAiSaveState('idle'), 2000);
    } catch {
      setAiError('Network error. Please try again.');
      setAiSaveState('error');
    }
  };

  // ── Notification toggle ─────────────────────────────────────────────────
  const handleNotifToggle = async (key: keyof typeof notifPrefs) => {
    const updated = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(updated);
    try {
      const res = await fetch('/api/user/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: updated }),
      });
      if (res.ok) {
        setSavedRows(prev => new Set([...prev, key]));
        setTimeout(() => setSavedRows(prev => { const n = new Set(prev); n.delete(key); return n; }), 1000);
      }
    } catch {
      // Silently revert on error
      setNotifPrefs(notifPrefs);
    }
  };

  // ── Keywords helpers ────────────────────────────────────────────────────
  const handleKeywordAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = bpKeywordInput.trim();
    if (!val || bpKeywords.includes(val) || bpKeywords.length >= 20) return;
    setBpKeywords(prev => [...prev, val]);
    setBpKeywordInput('');
  };

  const handleKeywordRemove = (kw: string) => {
    setBpKeywords(prev => prev.filter(k => k !== kw));
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Settings</h1>
      <p className="text-sm text-slate-500 mb-6">Manage your business profile, AI agent, notifications, and integrations.</p>

      {/* Tab bar */}
      <div className="flex gap-2 mb-6 border-b border-slate-200 pb-1">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                active
                  ? 'bg-indigo-50 text-primary border-indigo-100 shadow-sm'
                  : 'text-slate-500 border-transparent hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ─── Tab 1: Business Profile ──────────────────────────────────── */}
      {activeTab === 'business' && (
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex gap-3 text-sm text-amber-800">
            <Info className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
            <span>
              Changes here update your <strong>GMBBoost profile</strong>. To update your live Google Business Profile, use the{' '}
              <strong>Google Business Profile dashboard</strong> directly.
            </span>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
            <h2 className="text-base font-bold text-slate-900">Business Details</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <LabelRow label="Business Name *" />
                <input
                  className={inputCls('mt-1')}
                  value={bpForm.name}
                  onChange={e => setBpForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Acme Training Institute"
                />
              </div>
              <div>
                <LabelRow label="Primary Category" />
                <input
                  className={inputCls('mt-1')}
                  value={bpForm.category}
                  onChange={e => setBpForm(p => ({ ...p, category: e.target.value }))}
                  placeholder="IT Training Institute"
                />
              </div>
              <div className="col-span-1 sm:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <LabelRow label="Business Description" />
                  <span className={`text-xs ${bpDescLen > 750 ? 'text-red-500 font-semibold' : 'text-slate-400'}`}>
                    {bpDescLen}/750
                  </span>
                </div>
                <textarea
                  rows={4}
                  className={inputCls('resize-none')}
                  value={bpForm.description}
                  maxLength={750}
                  onChange={e => { setBpForm(p => ({ ...p, description: e.target.value })); setBpDescLen(e.target.value.length); }}
                  placeholder="Describe what your business does…"
                />
              </div>
              <div>
                <LabelRow label="Phone Number" />
                <input
                  className={inputCls('mt-1')}
                  value={bpForm.phone}
                  onChange={e => setBpForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+91XXXXXXXXXX"
                />
              </div>
              <div>
                <LabelRow label="Website URL" />
                <input
                  className={inputCls('mt-1')}
                  value={bpForm.website}
                  onChange={e => setBpForm(p => ({ ...p, website: e.target.value }))}
                  placeholder="https://example.com"
                />
              </div>
              <div className="col-span-1 sm:col-span-2">
                <LabelRow label="Full Address" />
                <input
                  className={inputCls('mt-1')}
                  value={bpForm.address}
                  onChange={e => setBpForm(p => ({ ...p, address: e.target.value }))}
                  placeholder="123 Main St, City, State"
                />
              </div>
              <div>
                <LabelRow label="Google Maps URL" />
                <input
                  className={inputCls('mt-1')}
                  value={bpForm.googleMapsUrl}
                  onChange={e => setBpForm(p => ({ ...p, googleMapsUrl: e.target.value }))}
                  placeholder="https://maps.google.com/…"
                />
              </div>
              <div>
                <LabelRow
                  label="Google Place ID"
                  hint="Found in your Google Maps URL after 'placeid=' — used to generate direct review links for your customers."
                />
                <input
                  className={inputCls('mt-1')}
                  value={bpForm.placeId}
                  onChange={e => setBpForm(p => ({ ...p, placeId: e.target.value }))}
                  placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
                />
              </div>
              <div>
                <LabelRow label="WhatsApp Number" />
                <input
                  className={inputCls('mt-1')}
                  value={bpForm.whatsappNumber}
                  onChange={e => setBpForm(p => ({ ...p, whatsappNumber: e.target.value }))}
                  placeholder="+91XXXXXXXXXX (E.164 format)"
                />
              </div>
            </div>

            {/* Keywords tag input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <LabelRow label="Keywords" />
                <span className="text-xs text-slate-400">{bpKeywords.length}/20</span>
              </div>
              <div className="border border-slate-200 rounded-xl p-3 min-h-[52px] flex flex-wrap gap-2 bg-white focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500">
                {bpKeywords.map(kw => (
                  <span
                    key={kw}
                    className="flex items-center gap-1 bg-indigo-50 text-primary text-xs font-semibold px-3 py-1.5 rounded-lg"
                  >
                    <Tag className="w-3 h-3" />
                    {kw}
                    <button
                      type="button"
                      onClick={() => handleKeywordRemove(kw)}
                      className="ml-1 hover:text-red-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {bpKeywords.length < 20 && (
                  <input
                    className="flex-1 min-w-[140px] text-sm outline-none bg-transparent placeholder:text-slate-400"
                    value={bpKeywordInput}
                    onChange={e => setBpKeywordInput(e.target.value)}
                    onKeyDown={handleKeywordAdd}
                    placeholder="Type a keyword and press Enter…"
                  />
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">These power keyword analysis in the audit engine.</p>
            </div>
          </div>

          {bpError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {bpError}
            </div>
          )}
          <div className="flex justify-end">
            <SaveButton state={bpSaveState} onSave={handleBpSave} />
          </div>
        </div>
      )}

      {/* ─── Tab 2: AI Agent ──────────────────────────────────────────── */}
      {activeTab === 'ai-agent' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">WhatsApp AI Agent Configuration</h2>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <span className="text-sm text-slate-600 font-medium">AI Enabled</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={aiForm.aiEnabled}
                  onClick={() => setAiForm(p => ({ ...p, aiEnabled: !p.aiEnabled }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    aiForm.aiEnabled ? 'bg-primary' : 'bg-slate-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      aiForm.aiEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">AI Personality</label>
                <select
                  className={inputCls()}
                  value={aiForm.aiPersonality}
                  onChange={e => setAiForm(p => ({ ...p, aiPersonality: e.target.value }))}
                >
                  <option>Professional</option>
                  <option>Friendly</option>
                  <option>Enthusiastic</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Response Tone</label>
                <select
                  className={inputCls()}
                  value={aiForm.tone}
                  onChange={e => setAiForm(p => ({ ...p, tone: e.target.value }))}
                >
                  <option>Formal</option>
                  <option>Conversational</option>
                  <option>Casual</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Max Response Length</label>
                <select
                  className={inputCls()}
                  value={aiForm.maxResponseLength}
                  onChange={e => setAiForm(p => ({ ...p, maxResponseLength: Number(e.target.value) }))}
                >
                  <option value={50}>Short (50 words)</option>
                  <option value={100}>Medium (100 words)</option>
                  <option value={200}>Long (200 words)</option>
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-500">System Prompt</label>
                <span className="text-xs text-slate-400">{aiForm.systemPrompt.length} chars</span>
              </div>
              <textarea
                rows={6}
                className={inputCls('resize-none')}
                value={aiForm.systemPrompt}
                onChange={e => setAiForm(p => ({ ...p, systemPrompt: e.target.value }))}
                placeholder={`You are a helpful assistant for ${activeBusiness?.name ?? '{businessName}'}. Your job is to qualify leads, answer questions about our courses, and help book demo sessions…`}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Sales Rules</label>
              <textarea
                rows={3}
                className={inputCls('resize-none')}
                value={aiForm.salesRules}
                onChange={e => setAiForm(p => ({ ...p, salesRules: e.target.value }))}
                placeholder="Never offer discounts without manager approval. Always collect name and phone before booking."
              />
            </div>
          </div>

          {/* Preview panel */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">How your AI will introduce itself</p>
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 shadow-sm">
              {getAIPreview(aiForm.aiPersonality, aiForm.tone, activeBusiness?.name ?? '')}
            </div>
            <p className="text-xs text-slate-400 mt-2">Updates live as you change personality and tone settings above.</p>
          </div>

          {aiError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {aiError}
            </div>
          )}
          <div className="flex justify-end">
            <SaveButton state={aiSaveState} onSave={handleAiSave} />
          </div>
        </div>
      )}

      {/* ─── Tab 3: Notifications ─────────────────────────────────────── */}
      {activeTab === 'notifications' && (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
          <NotifSection
            title="New Lead Alerts"
            rows={[
              {
                key: 'newLeadWhatsApp',
                icon: '📱',
                label: 'WhatsApp',
                desc: 'Send a WhatsApp to my number when a new lead comes in',
              },
              {
                key: 'newLeadEmail',
                icon: '📧',
                label: 'Email',
                desc: 'Send an email when a new lead comes in',
              },
            ]}
            prefs={notifPrefs}
            savedRows={savedRows}
            onToggle={handleNotifToggle}
          />
          <NotifSection
            title="Review Alerts"
            rows={[
              {
                key: 'newReviewEmail',
                icon: '📧',
                label: 'New Review Email',
                desc: 'Notify me when a new review is posted',
              },
              {
                key: 'criticalReviewWhatsApp',
                icon: '📱',
                label: 'Critical Review WhatsApp',
                desc: 'Immediate WhatsApp alert for 1–2 star reviews',
              },
            ]}
            prefs={notifPrefs}
            savedRows={savedRows}
            onToggle={handleNotifToggle}
          />
          <NotifSection
            title="Reports & Summaries"
            rows={[
              {
                key: 'weeklyDigestEmail',
                icon: '📧',
                label: 'Weekly Digest',
                desc: 'Weekly email summary of leads, reviews, and content stats',
              },
              {
                key: 'campaignCompletedEmail',
                icon: '📧',
                label: 'Campaign Completed',
                desc: 'Notify when a review campaign finishes its drip sequence',
              },
              {
                key: 'schedulerLowBufferEmail',
                icon: '📧',
                label: 'Low Content Buffer',
                desc: 'Warn me when scheduled posts drop below 7 days',
              },
            ]}
            prefs={notifPrefs}
            savedRows={savedRows}
            onToggle={handleNotifToggle}
          />
        </div>
      )}

      {/* ─── Tab 4: Integrations ──────────────────────────────────────── */}
      {activeTab === 'integrations' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <IntegCard
            title="Google Business Profile"
            connected={!!bpForm.placeId}
            connectedLabel="GBP Place ID configured"
            notConnectedLabel="Place ID not set"
            detail={bpForm.googleMapsUrl ? truncate(bpForm.googleMapsUrl, 48) : undefined}
            action={
              bpForm.googleMapsUrl ? (
                <a
                  href={bpForm.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary font-semibold hover:underline"
                >
                  View on Google Maps →
                </a>
              ) : (
                <button
                  onClick={() => setActiveTab('business')}
                  className="text-xs text-primary font-semibold hover:underline text-left"
                >
                  Add your GBP URL in Business Profile tab →
                </button>
              )
            }
          />

          <IntegCard
            title="WhatsApp (Twilio)"
            connected={!!(integStatus?.twilio && bpForm.whatsappNumber)}
            connectedLabel="Twilio connected"
            notConnectedLabel="Incomplete setup"
            detail={bpForm.whatsappNumber ? maskWhatsApp(bpForm.whatsappNumber) : undefined}
            action={
              <button
                onClick={() => setActiveTab('business')}
                className="text-xs text-primary font-semibold hover:underline text-left"
              >
                Update WhatsApp number in Business Profile tab →
              </button>
            }
          />

          <IntegCard
            title="SerpApi (Keyword Ranking)"
            connected={!!integStatus?.serpapi}
            connectedLabel="Connected"
            notConnectedLabel="Not configured"
            detail="Used for GMB audit and keyword ranking analysis"
          />

          <IntegCard
            title="Groq AI"
            connected={!!integStatus?.groq}
            connectedLabel="Connected"
            notConnectedLabel="Not configured"
            detail="Powers content generation, review replies, and WhatsApp AI"
          />

          <IntegCard
            title="Google Places API"
            connected={!!integStatus?.googlePlaces}
            connectedLabel="Connected"
            notConnectedLabel="Not configured"
            detail="Used for business search and onboarding"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NotifSection({
  title,
  rows,
  prefs,
  savedRows,
  onToggle,
}: {
  title: string;
  rows: { key: string; icon: string; label: string; desc: string }[];
  prefs: Record<string, boolean>;
  savedRows: Set<string>;
  onToggle: (key: any) => void;
}) {
  return (
    <div className="p-5">
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-3">
        {rows.map(row => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="text-lg leading-none mt-0.5">{row.icon}</span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{row.label}</p>
                <p className="text-xs text-slate-500">{row.desc}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {savedRows.has(row.key) && (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 animate-in fade-in" />
              )}
              <button
                type="button"
                role="switch"
                aria-checked={!!prefs[row.key]}
                onClick={() => onToggle(row.key)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  prefs[row.key] ? 'bg-primary' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    prefs[row.key] ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IntegCard({
  title,
  connected,
  connectedLabel,
  notConnectedLabel,
  detail,
  action,
}: {
  title: string;
  connected: boolean;
  connectedLabel: string;
  notConnectedLabel: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
            connected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {connected ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {connected ? connectedLabel : notConnectedLabel}
        </span>
      </div>
      {detail && <p className="text-xs text-slate-500 break-all">{detail}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function maskWhatsApp(num: string) {
  if (!num || num.length < 5) return num;
  return `${num.slice(0, 3)}-XXXXX-XX${num.slice(-3)}`;
}
