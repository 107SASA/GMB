'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2, PanelRight, Search, Send, Settings, X } from 'lucide-react';

type Filter = 'all' | 'unread' | 'mine' | 'unassigned' | 'human' | 'ai' | 'nurturing' | 'demo' | 'customers' | 'resolved';

interface ConversationCard {
  id: string;
  name: string;
  phone: string;
  preview: string;
  updatedAt: string;
  unread: boolean;
  leadScore: number;
  band: string;
  intent: string | null;
  ownership: string;
  status: string;
  assignedUserId: string | null;
  leadId: string | null;
}

interface TeamMember { id: string; name: string; email: string; role: string; activeConversations: number }
interface TimelineEvent { type: string; at: string; actor: string; payload: Record<string, unknown> }
interface ChatMessage { role: string; kind: 'customer' | 'ai' | 'human'; text: string; at: string; clientKey?: string | null }

interface Detail {
  id: string;
  windowOpen: boolean;
  blocked: string | null;
  banner: string;
  lead: null | {
    id: string; name: string | null; phone: string; email: string | null; company: string | null; createdAt: string;
    leadScore: number; band: string; intent: string | null; stage: string | null; nextBestAction: string | null;
    ownership: string; agent: string | null; assignedUserId: string | null;
    painPoints: string[]; interests: string[]; questions: string[]; objections: string[]; buyingSignals: string[];
    tags: string[]; notes: string; nurtureStatus: string | null;
  };
  nurture: null | { status: string; followUpsSent: number; version: number | null; lastAgentAt: string | null; nextAction: string | null; nextAt: string | null };
  demo: null | { id: string; status: string; date: string; timeSlot: string; timezone: string | null; salesperson: string | null; calendarEventId: string | null; meetingLink: string | null; reminders: { type?: string; status: string }[] };
  customer: null | { id: string; name: string; subscriptionStatus: string | null; plan: string | null; paymentStatus: string | null; activationDate: string | null; googleConnected: boolean; googleLocationId: string | null; city: string | null; since: string };
  messages: ChatMessage[];
  events: TimelineEvent[];
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'mine', label: 'My Conversations' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'human', label: 'Human Required' },
  { id: 'ai', label: 'AI Active' },
  { id: 'nurturing', label: 'Nurturing' },
  { id: 'demo', label: 'Demo' },
  { id: 'customers', label: 'Customers' },
  { id: 'resolved', label: 'Resolved' },
];

const SAFE_KEYS = ['from', 'to', 'reason', 'action', 'nextBestAction', 'outcome', 'signal', 'agent', 'reminderType'];

function when(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function textOr(value?: string | null) {
  return value && String(value).trim() ? String(value) : 'Not available';
}

function eventLabel(event: TimelineEvent): string {
  const payload = event.payload || {};
  switch (event.type) {
    case 'LEAD_CREATED': return 'Lead created';
    case 'LEAD_SCORE_CHANGED': return `Lead score changed: ${payload.from ?? '—'} → ${payload.to ?? '—'}`;
    case 'INTENT_CHANGED': return `Intent changed: ${payload.from || 'Unknown'} → ${payload.to || 'Unknown'}`;
    case 'AGENT_HANDOFF':
    case 'HUMAN_HANDOFF':
      return payload.to === 'HUMAN' ? 'AI transferred conversation to human' : `Ownership moved to ${payload.to || 'another owner'}`;
    case 'DEMO_SCHEDULED': return 'Demo scheduled';
    case 'DEMO_RESCHEDULED': return 'Demo rescheduled';
    case 'DEMO_CANCELLED': return 'Demo cancelled';
    case 'PAYMENT_SUCCESS': return 'Payment received';
    case 'CUSTOMER_ACTIVATED': return 'Subscription activated';
    case 'NURTURE_ACTION_SKIPPED': return `Nurture step skipped: ${payload.reason || 'Not available'}`;
    case 'OPT_OUT': return 'Customer opted out';
    case 'NBA_SELECTED': return `Next best action selected: ${payload.action || payload.nextBestAction || 'Not available'}`;
    case 'NBA_EXECUTED': return `AI action completed: ${payload.action || payload.outcome || 'Not available'}`;
    default: return event.type.replaceAll('_', ' ').toLowerCase();
  }
}

function Chip({ children }: { children: string }) {
  return <span className="inline-flex items-center rounded-full bg-primary-fixed px-2 py-0.5 text-[11px] font-medium text-primary-container">{children}</span>;
}

export default function WhatsAppInboxPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState('latest');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<ConversationCard[]>([]);
  const [counts, setCounts] = useState({ unread: 0, human: 0, mine: 0, highIntent: 0, demoToday: 0, failedMessages: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clientKey, setClientKey] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [intelOpen, setIntelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [note, setNote] = useState('');
  const [tag, setTag] = useState('');
  const [mobileThread, setMobileThread] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [settings, setSettings] = useState<{ enabled: boolean; assignOnTakeover: boolean; templateAccess: string; attachments: string; access: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const loadList = useCallback(async () => {
    const params = new URLSearchParams({ filter, sort, q: debounced });
    const res = await fetch(`/api/admin/inbox/conversations?${params}`);
    const data = await res.json();
    if (data.success) {
      setRows(data.conversations);
      setCounts(data.counts);
    }
    setLoadingList(false);
  }, [filter, sort, debounced]);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/admin/inbox/conversations/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (data.success) setDetail(data.conversation);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    fetch('/api/admin/inbox/team').then((res) => res.json()).then((data) => { if (data.success) setTeam(data.team); });
    fetch('/api/admin/inbox/settings').then((res) => res.json()).then((data) => { if (data.success) setSettings(data.settings); });
  }, []);
  useEffect(() => {
    const timer = setInterval(loadList, 8000);
    return () => clearInterval(timer);
  }, [loadList]);
  useEffect(() => {
    if (!selected) return;
    loadDetail(selected);
    const timer = setInterval(() => loadDetail(selected), 8000);
    return () => clearInterval(timer);
  }, [selected, loadDetail]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [detail?.messages.length, detail?.events.length]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setAssignOpen(false);
        setTemplateOpen(false);
        setIntelOpen(false);
        setSettingsOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const teammate = useMemo(() => new Map(team.map((person) => [person.id, person.name])), [team]);

  async function act(action: string, body?: object) {
    if (!selected) return null;
    const res = await fetch(`/api/admin/inbox/conversations/${encodeURIComponent(selected)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json();
    if (!data?.success && action !== 'send') setActionError(data?.error || 'That action could not be completed.');
    else if (action !== 'send') setActionError(null);
    await Promise.all([loadList(), loadDetail(selected)]);
    return data;
  }

  async function send(template?: string) {
    if (!selected || sending) return;
    const text = draft.trim();
    if (!text && !template) return;
    const key = clientKey || crypto.randomUUID();
    setClientKey(key);
    setSending(true);
    setSendError(null);
    const data = await act('send', { text, template, clientKey: key });
    setSending(false);
    if (!data?.success) {
      setSendError(data?.error === 'Message failed to send' ? 'Message failed to send' : (data?.error || 'Message failed to send'));
      return;
    }
    setDraft('');
    setClientKey(null);
    setTemplateOpen(false);
  }

  function onDraftKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (detail?.windowOpen) send();
    }
  }

  const empty = !loadingList && rows.length === 0
    ? (debounced ? 'No conversations found.' : filter === 'all' ? 'No WhatsApp conversations yet.' : 'No conversations require your attention.')
    : null;

  const timeline = useMemo(() => {
    if (!detail) return [];
    const messages = detail.messages.map((message) => ({ kind: 'message' as const, at: message.at, message }));
    const events = detail.events
      .filter((event) => event.type !== 'MESSAGE_RECEIVED' && event.type !== 'MESSAGE_SENT')
      .map((event) => ({ kind: 'event' as const, at: event.at, event }));
    return [...messages, ...events].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  }, [detail]);

  const aiEvents = detail?.events.filter((event) => ['NBA_SELECTED', 'NBA_EXECUTED', 'AGENT_HANDOFF', 'INTENT_CHANGED', 'LEAD_SCORE_CHANGED'].includes(event.type)).slice(-4) || [];
  const skipped = detail?.events.filter((event) => event.type === 'NURTURE_ACTION_SKIPPED').slice(-1)[0];

  return (
    <div className="-m-6 flex h-[calc(100dvh-48px)] w-[calc(100%+48px)] overflow-hidden bg-background text-on-surface">
      <section className={`${mobileThread ? 'hidden md:flex' : 'flex'} w-full md:w-[320px] shrink-0 flex-col border-r border-outline-variant bg-surface-container-lowest`}>
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">WhatsApp Inbox</h1>
            <button type="button" aria-label="Inbox settings" onClick={() => setSettingsOpen(true)} className="rounded-lg p-1.5 hover:bg-surface-container"><Settings size={16} /></button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
            <Chip>{`Unread ${counts.unread}`}</Chip>
            <Chip>{`Human ${counts.human}`}</Chip>
            <Chip>{`Mine ${counts.mine}`}</Chip>
            <Chip>{`High intent ${counts.highIntent}`}</Chip>
            <Chip>{`Demo today ${counts.demoToday}`}</Chip>
            <Chip>{`Failed ${counts.failedMessages}`}</Chip>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-outline-variant px-2">
            <Search size={14} className="text-on-surface-variant" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, phone, email, message, lead ID" className="w-full bg-transparent py-2 text-sm outline-none" />
          </div>
          <select value={sort} onChange={(event) => setSort(event.target.value)} className="mt-2 w-full rounded-lg border border-outline-variant bg-transparent px-2 py-1.5 text-xs">
            <option value="latest">Latest activity</option>
            <option value="unread">Unread first</option>
            <option value="score">Highest intent</option>
            <option value="human">Human attention required</option>
            <option value="mine">Assigned to me</option>
          </select>
        </div>
        <div className="flex gap-1 overflow-x-auto px-3 pb-2">
          {FILTERS.map((item) => (
            <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${filter === item.id ? 'bg-primary text-white' : 'bg-surface-container text-on-surface-variant'}`}>{item.label}</button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingList && <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={18} /></div>}
          {empty && <p className="px-4 py-8 text-sm text-on-surface-variant">{empty}</p>}
          {rows.map((row) => (
            <button key={row.id} type="button" onClick={() => { setSelected(row.id); setMobileThread(true); setSendError(null); setClientKey(null); }} className={`block w-full border-b border-outline-variant px-4 py-3 text-left hover:bg-surface-container ${selected === row.id ? 'bg-primary-fixed' : ''}`}>
              <div className="flex items-start gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-container text-xs font-semibold text-white">{(row.name || '?').slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{row.name}</span>
                    <span className="shrink-0 text-[11px] text-on-surface-variant">{when(row.updatedAt)}</span>
                  </span>
                  <span className="block truncate text-xs text-on-surface-variant">{row.phone}</span>
                  <span className="mt-1 block truncate text-xs">{row.preview || 'No messages yet'}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1">
                    <Chip>{row.ownership}</Chip>
                    <Chip>{`${row.band} ${row.leadScore}`}</Chip>
                    {row.intent && <Chip>{row.intent}</Chip>}
                    {row.unread && <span className="rounded-full bg-primary px-1.5 text-[10px] text-white">New</span>}
                  </span>
                  {row.assignedUserId && <span className="mt-1 block text-[11px] text-on-surface-variant">{teammate.get(row.assignedUserId) || 'Assigned'}</span>}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className={`${mobileThread ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {!detail && (
          <div className="flex flex-1 items-center justify-center text-sm text-on-surface-variant">Select a conversation to start</div>
        )}
        {detail && (
          <>
            <header className="sticky top-0 z-10 border-b border-outline-variant bg-surface-container-lowest px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button type="button" className="mb-1 text-xs text-primary md:hidden" onClick={() => setMobileThread(false)}>Back</button>
                  <h2 className="truncate text-base font-semibold">{detail.lead?.name || 'Unknown'}</h2>
                  <p className="text-xs text-on-surface-variant">{detail.lead?.phone} · {detail.lead?.stage || detail.lead?.ownership || 'Lead'}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Chip>{`${detail.lead?.band || 'COLD'} ${detail.lead?.leadScore ?? 0}`}</Chip>
                    <Chip>{textOr(detail.lead?.intent)}</Chip>
                    <Chip>{textOr(detail.lead?.stage)}</Chip>
                    <Chip>{detail.lead?.ownership || 'AI Active'}</Chip>
                    <Chip>{detail.lead?.assignedUserId ? (teammate.get(detail.lead.assignedUserId) || 'Assigned') : 'Unassigned'}</Chip>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <button type="button" onClick={() => act('takeover')} className="rounded-lg bg-primary px-2.5 py-1.5 text-xs text-white">Take Over</button>
                  <button type="button" onClick={() => setAssignOpen(true)} className="rounded-lg border border-outline-variant px-2.5 py-1.5 text-xs">Assign</button>
                  <button type="button" onClick={() => act('return-to-ai')} className="rounded-lg border border-outline-variant px-2.5 py-1.5 text-xs">Return to AI</button>
                  <button type="button" onClick={() => act(detail.lead?.ownership === 'Resolved' ? 'reopen' : 'resolve')} className="rounded-lg border border-outline-variant px-2.5 py-1.5 text-xs">{detail.lead?.ownership === 'Resolved' ? 'Reopen' : 'Resolve'}</button>
                  <button type="button" aria-label="Lead intelligence" onClick={() => setIntelOpen(true)} className="rounded-lg border border-outline-variant p-1.5 xl:hidden"><PanelRight size={14} /></button>
                </div>
              </div>
              <p className={`mt-2 rounded-lg px-3 py-1.5 text-xs ${detail.banner.startsWith('Human') ? 'bg-error-container text-error' : 'bg-primary-fixed text-primary-container'}`}>{detail.banner}</p>
              {actionError && <p className="mt-2 text-xs text-error">{actionError}</p>}
            </header>
            <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {timeline.map((item, index) => item.kind === 'event' ? (
                <div key={`e-${index}`} className="mx-auto max-w-md rounded-full bg-surface-container px-3 py-1 text-center text-[11px] text-on-surface-variant">{eventLabel(item.event)} · {when(item.at)}</div>
              ) : (
                <div key={`m-${index}`} className={`flex ${item.message.kind === 'customer' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${item.message.kind === 'customer' ? 'bg-surface-container' : item.message.kind === 'human' ? 'bg-primary text-white' : 'bg-primary-fixed text-on-surface'}`}>
                    <p className="mb-1 text-[10px] uppercase tracking-wide opacity-70">{item.message.kind === 'customer' ? 'Customer' : item.message.kind === 'human' ? 'Human' : 'AI'}</p>
                    <p className="whitespace-pre-wrap">{item.message.text}</p>
                    <p className="mt-1 text-[10px] opacity-70">{when(item.message.at)}</p>
                  </div>
                </div>
              ))}
            </div>
            <footer className="sticky bottom-0 border-t border-outline-variant bg-surface-container-lowest p-3">
              {detail.blocked && <p className="mb-2 text-xs text-error">This lead cannot be contacted.</p>}
              {!detail.windowOpen && !detail.blocked && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-error-container px-3 py-2 text-xs text-error">
                  <span>WhatsApp customer-service window is closed. Select an approved template to continue.</span>
                  <button type="button" onClick={() => setTemplateOpen(true)} className="shrink-0 rounded-lg bg-primary px-2 py-1 text-white">Choose Template</button>
                </div>
              )}
              {sendError && (
                <div className="mb-2 flex items-center justify-between text-xs text-error">
                  <span>{sendError}</span>
                  <button type="button" onClick={() => send(detail.windowOpen ? undefined : 'notification')} className="underline">Retry</button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <button type="button" disabled title="File uploads are not configured. Text and approved templates are available." className="rounded-lg border border-outline-variant px-2 py-2 text-xs text-on-surface-variant">Attach</button>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onDraftKey} disabled={!!detail.blocked || !detail.windowOpen} rows={2} placeholder={detail.windowOpen ? 'Type a reply…' : 'Choose an approved template'} className="min-h-12 flex-1 resize-none rounded-xl border border-outline-variant bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-60" />
                <button type="button" onClick={() => send()} disabled={sending || !!detail.blocked || !detail.windowOpen} className="rounded-xl bg-primary p-2.5 text-white disabled:opacity-50">{sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button>
              </div>
            </footer>
          </>
        )}
      </section>

      <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l border-outline-variant bg-surface-container-lowest xl:block">
        {detail ? <Intelligence detail={detail} teammate={teammate} note={note} setNote={setNote} tag={tag} setTag={setTag} act={act} aiOpen={aiOpen} setAiOpen={setAiOpen} aiEvents={aiEvents} skipped={skipped} /> : <p className="p-4 text-sm text-on-surface-variant">Select a conversation to start</p>}
      </aside>

      {intelOpen && detail && (
        <div className="fixed inset-0 z-40 xl:hidden">
          <button type="button" className="absolute inset-0 bg-black/30" onClick={() => setIntelOpen(false)} aria-label="Close intelligence" />
          <div className="absolute right-0 top-0 h-full w-[min(100%,380px)] overflow-y-auto bg-surface-container-lowest p-2">
            <button type="button" className="m-2 rounded-lg p-1" onClick={() => setIntelOpen(false)} aria-label="Close"><X size={16} /></button>
            <Intelligence detail={detail} teammate={teammate} note={note} setNote={setNote} tag={tag} setTag={setTag} act={act} aiOpen={aiOpen} setAiOpen={setAiOpen} aiEvents={aiEvents} skipped={skipped} />
          </div>
        </div>
      )}

      {assignOpen && (
        <Modal title="Assign conversation" onClose={() => setAssignOpen(false)}>
          <button type="button" className="mb-2 w-full rounded-lg border border-outline-variant px-3 py-2 text-left text-sm" onClick={() => { act('assign', { userId: null }); setAssignOpen(false); }}>Unassign</button>
          {team.map((person) => (
            <button key={person.id} type="button" className="mb-2 w-full rounded-lg border border-outline-variant px-3 py-2 text-left" onClick={() => { act('assign', { userId: person.id }); setAssignOpen(false); }}>
              <span className="block text-sm font-medium">{person.name}</span>
              <span className="block text-xs text-on-surface-variant">{person.email} · {person.role} · {person.activeConversations} active</span>
            </button>
          ))}
        </Modal>
      )}

      {templateOpen && (
        <Modal title="Approved template" onClose={() => setTemplateOpen(false)}>
          <p className="text-sm">GrowwMatics update</p>
          <p className="mt-2 rounded-lg bg-surface-container p-3 text-sm">Hi {detail?.lead?.name || 'there'} — {draft || 'Your message'}</p>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} placeholder="Message inside the approved template" className="mt-3 w-full rounded-lg border border-outline-variant bg-transparent px-3 py-2 text-sm" />
          <button type="button" disabled={sending || !draft.trim()} onClick={() => send('notification')} className="mt-3 rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">Send template</button>
        </Modal>
      )}

      {settingsOpen && settings && (
        <Modal title="WhatsApp Inbox" onClose={() => setSettingsOpen(false)}>
          <label className="mb-3 flex items-center justify-between text-sm">Human inbox
            <input type="checkbox" checked={settings.enabled} onChange={async (event) => {
              const res = await fetch('/api/admin/inbox/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: event.target.checked }) });
              const data = await res.json();
              if (data.success) setSettings({ ...settings, ...data.settings });
            }} />
          </label>
          <label className="mb-3 flex items-center justify-between text-sm">Assign me on takeover
            <input type="checkbox" checked={settings.assignOnTakeover} onChange={async (event) => {
              const res = await fetch('/api/admin/inbox/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignOnTakeover: event.target.checked }) });
              const data = await res.json();
              if (data.success) setSettings({ ...settings, ...data.settings });
            }} />
          </label>
          <p className="text-xs text-on-surface-variant">Access: {settings.access}</p>
          <p className="mt-1 text-xs text-on-surface-variant">Templates: {settings.templateAccess}</p>
          <p className="mt-1 text-xs text-on-surface-variant">Attachments: {settings.attachments}</p>
          <p className="mt-1 text-xs text-on-surface-variant">The 24-hour customer-service window is enforced by the existing WhatsApp send path.</p>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/30" onClick={onClose} aria-label="Close dialog" />
      <div className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface-container-lowest p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{title}</h3><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        {children}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return <p className="text-xs"><span className="text-on-surface-variant">{label}: </span>{textOr(value)}</p>;
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-xl border border-outline-variant p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">{title}</h4>
      {items.length === 0 ? <p className="mt-1 text-sm">Not available</p> : <ul className="mt-1 space-y-1 text-sm">{items.map((item) => <li key={item}>{item}</li>)}</ul>}
    </section>
  );
}

function Intelligence({ detail, teammate, note, setNote, tag, setTag, act, aiOpen, setAiOpen, aiEvents, skipped }: {
  detail: Detail;
  teammate: Map<string, string>;
  note: string;
  setNote: (value: string) => void;
  tag: string;
  setTag: (value: string) => void;
  act: (action: string, body?: object) => Promise<any>;
  aiOpen: boolean;
  setAiOpen: (value: boolean) => void;
  aiEvents: TimelineEvent[];
  skipped?: TimelineEvent;
}) {
  const lead = detail.lead;
  return (
    <div className="space-y-3 p-3">
      <section className="rounded-xl border border-outline-variant p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Customer / lead</h3>
        <div className="mt-2 space-y-1">
          <Fact label="Name" value={lead?.name} />
          <Fact label="Phone" value={lead?.phone} />
          <Fact label="Email" value={lead?.email} />
          <Fact label="Company" value={lead?.company} />
          <Fact label="Created" value={lead?.createdAt ? new Date(lead.createdAt).toLocaleDateString() : null} />
          <Fact label="Score" value={lead ? `${lead.leadScore} / 100 · ${lead.band}` : null} />
          <Fact label="Intent" value={lead?.intent} />
          <Fact label="Stage" value={lead?.stage} />
          <Fact label="Next best action" value={lead?.nextBestAction} />
          <Fact label="Ownership" value={lead?.assignedUserId ? `${lead.ownership} · ${teammate.get(lead.assignedUserId) || 'Assigned'}` : lead?.ownership} />
        </div>
      </section>
      <ListCard title="Interests" items={lead?.interests || []} />
      <ListCard title="Pain points" items={lead?.painPoints || []} />
      <ListCard title="Questions" items={lead?.questions || []} />
      <ListCard title="Objections" items={lead?.objections || []} />
      <ListCard title="Buying signals" items={lead?.buyingSignals || []} />
      <section className="rounded-xl border border-outline-variant p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Conversation summary</h4>
        <p className="mt-1 text-sm">Not available</p>
      </section>
      <section className="rounded-xl border border-outline-variant p-3">
        <button type="button" className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant" onClick={() => setAiOpen(!aiOpen)}>AI activity</button>
        {aiOpen && (
          <div className="mt-2 space-y-2">
            {aiEvents.length === 0 && <p className="text-sm">Not available</p>}
            {aiEvents.map((event, index) => (
              <div key={index} className="text-xs">
                <p className="font-medium">{eventLabel(event)}</p>
                {SAFE_KEYS.filter((key) => event.payload?.[key] != null).map((key) => (
                  <p key={key}>{key}: {String(event.payload[key])}</p>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="rounded-xl border border-outline-variant p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Nurture</h4>
        {detail.nurture ? (
          <div className="mt-1 space-y-1">
            <Fact label="Status" value={detail.nurture.status} />
            <Fact label="Completed steps" value={String(detail.nurture.followUpsSent)} />
            <Fact label="Config version" value={detail.nurture.version == null ? null : String(detail.nurture.version)} />
            <Fact label="Next action" value={detail.nurture.nextAction} />
            <Fact label="Next time" value={detail.nurture.nextAt ? new Date(detail.nurture.nextAt).toLocaleString() : null} />
            <Fact label="Last message" value={detail.nurture.lastAgentAt ? new Date(detail.nurture.lastAgentAt).toLocaleString() : null} />
            {skipped && <p className="text-xs">Skipped: {String(skipped.payload?.reason || 'Not available')}</p>}
          </div>
        ) : <p className="mt-1 text-sm">Not available</p>}
      </section>
      <section className="rounded-xl border border-outline-variant p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Demo</h4>
        {detail.demo ? (
          <div className="mt-1 space-y-1">
            <Fact label="Status" value={detail.demo.status} />
            <Fact label="Date" value={detail.demo.date} />
            <Fact label="Time" value={detail.demo.timeSlot} />
            <Fact label="Salesperson" value={detail.demo.salesperson} />
            <Fact label="Calendar event" value={detail.demo.calendarEventId} />
            <p className="text-xs">Reminders: {['24h', '1h', '15m'].map((type) => `${type} ${detail.demo?.reminders.find((item) => item.type === type)?.status || 'Not available'}`).join(' · ')}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <a className="text-primary" href="/admin/demo-bookings">Open demo</a>
              {detail.demo.meetingLink?.startsWith('https://') && <button type="button" className="text-primary" onClick={() => navigator.clipboard.writeText(detail.demo!.meetingLink!)}>Copy Meet link</button>}
              <a className="text-primary" href="/admin/demo-bookings">Reschedule</a>
              <button type="button" className="text-error" onClick={() => { if (confirm('Cancel this demo?')) act('cancel-demo'); }}>Cancel</button>
            </div>
          </div>
        ) : <p className="mt-1 text-sm">Not available</p>}
      </section>
      <section className="rounded-xl border border-outline-variant p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Customer</h4>
        {detail.customer ? (
          <div className="mt-1 space-y-1">
            <Fact label="Subscription" value={detail.customer.subscriptionStatus} />
            <Fact label="Plan" value={detail.customer.plan} />
            <Fact label="Payment" value={detail.customer.paymentStatus} />
            <Fact label="Activated" value={detail.customer.activationDate ? new Date(detail.customer.activationDate).toLocaleDateString() : null} />
            <Fact label="Customer since" value={new Date(detail.customer.since).toLocaleDateString()} />
            <Fact label="Google Business Profile" value={detail.customer.googleConnected ? 'Connected' : 'Not connected'} />
            <Fact label="Google location" value={detail.customer.googleLocationId || detail.customer.city} />
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <a className="text-primary" href="/admin/customers">View customer</a>
              <a className="text-primary" href="/admin/subscriptions">View subscription</a>
              <a className="text-primary" href="/admin/businesses">View Google Business Profile</a>
              <a className="text-primary" href="/admin/audits">View reports</a>
            </div>
          </div>
        ) : <p className="mt-1 text-sm">Not available</p>}
      </section>
      <section className="rounded-xl border border-outline-variant p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Notes and tags</h4>
        <p className="mt-1 whitespace-pre-wrap text-xs">{lead?.notes || 'Not available'}</p>
        <div className="mt-2 flex flex-wrap gap-1">{(lead?.tags || []).map((item) => <Chip key={item}>{item}</Chip>)}</div>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Internal note. This is not sent to the customer." className="mt-2 w-full rounded-lg border border-outline-variant bg-transparent px-2 py-1 text-xs" />
        <button type="button" className="mt-1 text-xs text-primary" onClick={() => { if (note.trim()) { act('notes', { note }); setNote(''); } }}>Add note</button>
        <div className="mt-2 flex gap-1">
          <input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Add tag" className="flex-1 rounded-lg border border-outline-variant bg-transparent px-2 py-1 text-xs" />
          <button type="button" className="text-xs text-primary" onClick={() => { if (tag.trim()) { act('notes', { tags: [...(lead?.tags || []), tag.trim()] }); setTag(''); } }}>Add</button>
        </div>
      </section>
      <div className="flex flex-wrap gap-2 text-xs">
        <a className="text-primary" href="/admin/demo-bookings">Schedule demo</a>
        <button type="button" className="text-primary" onClick={() => act('takeover')}>Take over</button>
        <button type="button" className="text-primary" onClick={() => act('resolve')}>Resolve</button>
      </div>
    </div>
  );
}
