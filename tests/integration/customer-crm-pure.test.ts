/**
 * Customer CRM — pure rules (sources, AI scoring prompt, ROI, stages,
 * telephony normalization, removed auto-WhatsApp, stage migration).
 * Run: node --experimental-strip-types --test tests/integration/customer-crm-pure.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalSource, CUSTOMER_LEAD_SOURCES, ORGANIC_SOURCES } from '../../src/services/crm/sources.ts';
import { computeCrmRoi, missedOpportunityLines } from '../../src/services/crm/roi.ts';
import {
  assignSubStageIds,
  DEFAULT_LEAD_STAGES,
  legacyColumnToStage,
  resolveLeadStagesConfig,
  resolveStage,
  sanitizeLeadStagesConfig,
} from '../../src/lib/leadStages.ts';
import { nextOutcome, twilioAdapter } from '../../src/services/telephony/normalize.ts';
import { handleLegacyCrmDispatch } from '../../src/services/crm/legacyDispatch.ts';
import { planLeadStageMigration } from '../../src/services/crm/stageMigration.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── Sources ──────────────────────────────────────────────────────────────

test('sources: every creation path maps to a valid enum value (campaign import no longer "Import")', () => {
  assert.equal(canonicalSource('import'), 'CSV Import');
  assert.equal(canonicalSource('Import'), 'CSV Import');
  assert.equal(canonicalSource('campaign'), 'Campaign Import');
  assert.equal(canonicalSource('Campaign Import'), 'Campaign Import');
  assert.equal(canonicalSource('whatsapp'), 'WhatsApp');
  assert.equal(canonicalSource('nonsense'), 'Manual');
  assert.equal(canonicalSource('nonsense', 'CSV Import'), 'CSV Import');
  assert.equal(canonicalSource(undefined), 'Manual');
  const leadModel = read('src/models/Lead.ts');
  for (const s of CUSTOMER_LEAD_SOURCES) assert.ok(leadModel.includes(`'${s}'`), `Lead.source enum contains ${s}`);
  assert.ok(!ORGANIC_SOURCES.has('CSV Import') && !ORGANIC_SOURCES.has('Contacts Import') && !ORGANIC_SOURCES.has('Campaign Import'));
});

// ── AI scoring prompt ────────────────────────────────────────────────────

test('no Customer CRM AI lead scoring: service, prompt, rescore job/event and score fields are gone', () => {
  for (const f of ['src/services/crm/leadScoring.ts', 'src/services/crm/leadScoringPrompt.ts']) {
    assert.equal(fs.existsSync(path.join(ROOT, f)), false, `${f} removed`);
  }
  const fns = read('src/services/inngest/functions.ts');
  const sStart = fns.indexOf('export const scheduleLeadFollowUpsJob');
  const sched = fns.slice(sStart, fns.indexOf('\n);', sStart));
  assert.doesNotMatch(sched, /groq|Groq|scor|ai-lead|chat\.completions/i, 'new-lead job makes no AI call');
  assert.doesNotMatch(fns, /crmLeadRescoreJob|crm\/lead-rescore|services\/crm\/leadScoring/);
  assert.doesNotMatch(read('src/services/inngest/client.ts'), /crm\/lead-rescore/);
  assert.doesNotMatch(read('src/app/api/inngest/route.ts'), /Rescore/i);
  // No Groq / LLM anywhere in the Customer CRM service layer or its routes.
  const crmFiles = [
    ...fs.readdirSync(path.join(ROOT, 'src/services/crm')).map((f) => `src/services/crm/${f}`),
    'src/app/api/crm/leads/route.ts', 'src/app/api/crm/leads/[id]/route.ts', 'src/app/api/crm/leads/[id]/activity/route.ts',
    'src/app/api/crm/leads/import/route.ts', 'src/app/api/leads/quick-add/route.ts', 'src/app/api/leads/bulk-import/route.ts',
    'src/app/api/campaigns/import/route.ts', 'src/app/api/appointments/route.ts', 'src/app/api/twilio/voice/route.ts',
  ];
  for (const f of crmFiles) assert.doesNotMatch(read(f), /groq|queueRescore|scoreCustomerLead|aiScoreSource|(?<!-)aiLeadScore/i, `${f} has no AI scoring (an exclusion like -aiLeadScore is allowed)`);
  // Customer-CRM-only score fields removed from the schema.
  const lead = read('src/models/Lead.ts');
  assert.doesNotMatch(lead, /aiScoreSource|aiScoredAt|aiScoreFactors/);
  // Shared with the platform/admin CRM (free report, demo, admin pages) → kept.
  assert.match(lead, /aiLeadScore: \{ type: Number \}/);
  assert.doesNotMatch(read('src/models/Activity.ts'), /'ai_score'/);
});

test('no AI score in the Customer CRM UI (web + mobile)', () => {
  const ui = [
    'src/app/dashboard/crm/page.tsx', 'src/components/crm/CRMStatsRow.tsx', 'src/components/crm/CRMAnalytics.tsx',
    'src/components/crm/KanbanBoard.tsx', 'src/components/crm/LeadCard.tsx', 'src/components/crm/LeadListView.tsx',
    'src/components/crm/LeadDrawer.tsx', 'src/components/crm/ActivityTimeline.tsx', 'src/components/crm/CRMFilterBar.tsx',
    'src/components/dashboard/QuickPanels.tsx',
    'mobile/src/app/(app)/leads/index.tsx', 'mobile/src/app/(app)/leads/[id].tsx', 'mobile/src/api/endpoints/leads.ts', 'mobile/src/api/endpoints/crm.ts',
  ];
  for (const f of ui) assert.doesNotMatch(read(f), /aiLeadScore|aiInsights|aiScoreSource|AI Score|AI Lead Score|LLaMA|Hot Lead|ai_score|qualificationStatus/i, `${f}`);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/components/crm/LeadDetailsDrawer.tsx')), false, 'unused score drawer removed');
  const page = read('src/app/dashboard/crm/page.tsx');
  assert.match(page, /Intelligent CRM with smart follow-up reminders\./);
  const stats = read('src/components/crm/CRMStatsRow.tsx');
  for (const label of ['Total Leads', 'Follow-ups Due', 'Won', 'Revenue']) assert.match(stats, new RegExp(`>${label}<`));
});

// ── ROI ──────────────────────────────────────────────────────────────────

const FROM = new Date('2026-09-01T00:00:00Z');
const TO = new Date('2026-10-01T00:00:00Z');
const lead = (o: Record<string, unknown>) => ({ createdAt: '2026-09-10T00:00:00Z', source: 'WhatsApp', lifeCycleStage: 'active', ...o });

test('ROI: converted = lifeCycleStage converted; revenue only from recorded deal values', () => {
  const r = computeCrmRoi({
    from: FROM, to: TO, calls: [],
    leads: [
      lead({ lifeCycleStage: 'converted', deal: { value: 30000, currency: 'INR' } }),
      lead({ lifeCycleStage: 'converted', deal: { value: 10000, currency: 'INR' } }),
      lead({ lifeCycleStage: 'converted', deal: { value: null, valueMissing: true } }),
      lead({ pipelineStage: 'Converted' } as any), // legacy field alone is NOT a conversion
      lead({ source: 'Referral' }),
      lead({ createdAt: '2026-08-01T00:00:00Z', lifeCycleStage: 'converted', deal: { value: 99999 } }), // outside period
    ],
  });
  assert.equal(r.totalLeads, 5);
  assert.equal(r.convertedLeads, 3);
  assert.equal(r.convertedWithoutValue, 1);
  assert.equal(r.wonRevenue, 40000);
  assert.equal(r.conversionRate, 60);
  assert.equal(r.averageDealValue, 20000, 'average over deals WITH a value');
  assert.equal(r.revenuePerLead, 8000);
  const wa = r.bySource.find((s) => s.source === 'WhatsApp')!;
  assert.equal(wa.leads, 4);
  assert.equal(wa.converted, 3);
  assert.equal(wa.wonRevenue, 40000);
});

test('ROI: no investment → ROI unavailable (never a fake 0%)', () => {
  const r = computeCrmRoi({ from: FROM, to: TO, calls: [], leads: [lead({ lifeCycleStage: 'converted', deal: { value: 5000 } })] });
  assert.equal(r.roiPercent, null);
  assert.equal(r.investment, null);
  assert.equal(r.roiNote, 'ROI unavailable — investment/cost not configured.');
});

test('ROI: with a monthly investment → prorated and computed', () => {
  const r = computeCrmRoi({
    from: FROM, to: TO, calls: [],
    leads: [lead({ lifeCycleStage: 'converted', deal: { value: 20000 } })],
    investment: { monthlyAmount: 10000, currency: 'INR' },
  });
  assert.equal(r.investment!.amount, Math.round(10000 * (30 / 30.44)));
  assert.equal(r.roiPercent, Math.round(((20000 - r.investment!.amount) / r.investment!.amount) * 1000) / 10);
});

test('ROI: empty period → no NaN, rates null', () => {
  const r = computeCrmRoi({ from: FROM, to: TO, calls: [], leads: [] });
  assert.equal(r.conversionRate, null);
  assert.equal(r.averageDealValue, null);
  assert.equal(r.revenuePerLead, null);
  assert.equal(r.wonRevenue, 0);
});

test('Phone stats + missed opportunities are counts only, never money', () => {
  const at = '2026-09-15T10:00:00Z';
  const r = computeCrmRoi({
    from: FROM, to: TO, leads: [],
    calls: [
      { phone: '+911', startedAt: at, outcome: 'missed', leadState: 'pending' },
      { phone: '+911', startedAt: at, outcome: 'answered', leadState: 'dismissed' },
      { phone: '+912', startedAt: at, outcome: 'ended', leadState: 'saved', leadId: 'a' },
      { phone: '+913', startedAt: at, outcome: 'ended', leadState: 'existing_lead', leadId: 'b' },
    ],
    callLeads: [lead({ lifeCycleStage: 'converted', deal: { value: 7000 } })],
  });
  assert.deepEqual(
    { ...r.phone },
    { observed: true, callsReceived: 4, uniqueCallers: 3, missedCalls: 1, callsFromKnownLeads: 1, savedAsLeads: 1, notSaved: 2, convertedCallLeads: 1, callLeadRevenue: 7000 },
  );
  const lines = missedOpportunityLines(r);
  assert.ok(lines.some((l) => /2 calls were not saved/.test(l)));
  assert.ok(lines.every((l) => !/₹|INR|revenue|lost \d/i.test(l)), 'no fabricated lost revenue');
});

// ── Stages ───────────────────────────────────────────────────────────────

test('stages: stable ids; resolve by id or name; mismatch rejected', () => {
  const cfg = resolveLeadStagesConfig(null);
  assert.ok(cfg.active.every((s) => s.id));
  assert.deepEqual(resolveStage(cfg, { lifeCycleStage: 'converted', subStageId: 'converted-sales-closed' }), { lifeCycleStage: 'converted', subStageId: 'converted-sales-closed', subStage: 'Sales Closed' });
  assert.deepEqual(resolveStage(cfg, { lifeCycleStage: 'active', subStage: 'interested' }), { lifeCycleStage: 'active', subStageId: 'active-interested', subStage: 'Interested' });
  assert.equal(resolveStage(cfg, { lifeCycleStage: 'active', subStageId: 'closed-lost' }), null, 'sub-stage of another group');
  assert.equal(resolveStage(cfg, { lifeCycleStage: 'bogus' }), null);
  assert.deepEqual(resolveStage(cfg, { lifeCycleStage: 'initial', subStage: 'x' }), { lifeCycleStage: 'initial', subStageId: null, subStage: null });
});

test('stages: a rename keeps the id; a new stage never steals a renamed one\'s id', () => {
  const prev = resolveLeadStagesConfig(DEFAULT_LEAD_STAGES);
  const edited = sanitizeLeadStagesConfig({
    ...prev,
    active: [{ name: 'New', color: 'sky' }, ...prev.active.map((s) => (s.id === 'active-new' ? { ...s, name: 'Fresh' } : s))],
  })!;
  const next = assignSubStageIds(edited, prev);
  assert.equal(next.active.find((s) => s.name === 'Fresh')!.id, 'active-new');
  const added = next.active.find((s) => s.name === 'New')!;
  assert.notEqual(added.id, 'active-new');
  assert.equal(new Set(next.active.map((s) => s.id)).size, next.active.length);
  // Older client (no ids) → ids recovered by name.
  const noIds = sanitizeLeadStagesConfig({ ...prev, closed: prev.closed.map(({ name, color }) => ({ name, color })) })!;
  assert.deepEqual(assignSubStageIds(noIds, prev).closed.map((s) => s.id), prev.closed.map((s) => s.id));
});

test('stages: legacy app column → canonical stage (compatibility shim only)', () => {
  const cfg = resolveLeadStagesConfig(null);
  assert.deepEqual(legacyColumnToStage(cfg, 'Interested'), { lifeCycleStage: 'active', subStageId: 'active-interested', subStage: 'Interested' });
  assert.equal(legacyColumnToStage(cfg, 'Qualified'), null);
});

test('mobile uses the same stage model (no kanban-columns / pipelineStage writes)', () => {
  const files = ['mobile/src/app/(app)/leads/index.tsx', 'mobile/src/app/(app)/leads/[id].tsx', 'mobile/src/api/endpoints/leads.ts'];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /kanban-columns|fetchKanbanColumns/, `${f} no longer reads Kanban columns`);
    assert.doesNotMatch(src, /mutate\(\{\s*pipelineStage/, `${f} never writes pipelineStage`);
  }
  assert.match(read('mobile/src/api/endpoints/crm.ts'), /\/api\/business\/lead-stages/);
});

// ── Telephony ────────────────────────────────────────────────────────────

test('telephony: Twilio webhooks normalize to provider-agnostic events', () => {
  const base = { CallSid: 'CA1', From: '+919800000001', To: '+14155550100', Direction: 'inbound' };
  assert.equal(twilioAdapter.normalize({ ...base, CallStatus: 'ringing' })!.kind, 'incoming_call');
  assert.equal(twilioAdapter.normalize({ ...base, CallStatus: 'in-progress' })!.kind, 'call_answered');
  assert.equal(twilioAdapter.normalize({ ...base, CallStatus: 'no-answer' })!.kind, 'call_missed');
  assert.equal(twilioAdapter.normalize({ ...base, CallStatus: 'busy' })!.kind, 'call_missed');
  assert.equal(twilioAdapter.normalize({ ...base, CallStatus: 'completed', CallDuration: '0' })!.kind, 'call_missed');
  const ended = twilioAdapter.normalize({ ...base, CallStatus: 'completed', CallDuration: '42', CallerName: 'RAHUL' })!;
  assert.equal(ended.kind, 'call_ended');
  assert.equal(ended.durationSec, 42);
  assert.equal(ended.phone, '+919800000001');
  assert.equal(ended.businessNumber, '+14155550100');
  assert.equal(ended.callerName, 'RAHUL');
  assert.equal(ended.recordingUrl, null, 'recordings never passed through by default');
  const out = twilioAdapter.normalize({ CallSid: 'CA2', From: '+14155550100', To: '+919800000002', Direction: 'outbound-dial', CallStatus: 'ringing' })!;
  assert.equal(out.kind, 'outgoing_call');
  assert.equal(out.phone, '+919800000002');
  assert.equal(twilioAdapter.normalize({ From: '+91' }), null, 'no CallSid → ignored');
  assert.equal(nextOutcome('ended', 'call_answered'), 'ended', 'never downgrades a finished call');
  assert.equal(nextOutcome('ringing', 'call_missed'), 'missed');
});

// ── No automatic WhatsApp to leads ───────────────────────────────────────

test('removed Day 1/3/7 chain: legacy dispatch never sends', () => {
  assert.deepEqual(handleLegacyCrmDispatch({ leadId: 'x', templateType: 'day1' }), { skipped: true, reason: 'customer-crm-auto-whatsapp-removed', sent: 0 });
  const fns = read('src/services/inngest/functions.ts');
  const start = fns.indexOf('export const dispatchWhatsappFollowUpJob');
  const body = fns.slice(start, fns.indexOf('\n);', start));
  assert.match(body, /handleLegacyCrmDispatch/);
  assert.doesNotMatch(body, /sendOutboundMessage/, 'the customer CRM dispatch job has no send path');
  const sStart = fns.indexOf('export const scheduleLeadFollowUpsJob');
  const sched = fns.slice(sStart, fns.indexOf('\n);', sStart));
  assert.doesNotMatch(sched, /step\.sleep|crm\/dispatch-whatsapp/, 'no Day 1/3/7 sleeps or dispatches');
  for (const f of ['src/services/crm/customerLeads.ts', 'src/services/crm/followUps.ts', 'src/services/crm/calls.ts']) {
    assert.doesNotMatch(read(f), /sendOutboundMessage|sendWhatsApp/i, `${f} never messages the lead`);
  }
});

// ── Super-admin CRM regression ───────────────────────────────────────────

test('super-admin CRM untouched: no admin / sales-agent / nurture / lead-engine file changed', async () => {
  const { execFileSync } = await import('node:child_process');
  let changed: string[];
  try {
    changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' })
      .split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).trim());
  } catch {
    return; // no git (e.g. a packaged build) — nothing to compare
  }
  const forbidden = /(^|\/)(admin|sales[-_]?agent|salesAgent|nurture|lead[-_]?engine|leadEngine|conversion)(\/|\.|-|$)/i;
  const hits = changed.filter((f) => forbidden.test(f));
  assert.deepEqual(hits, [], `super-admin files changed: ${hits.join(', ')}`);
  // The platform tenant is refused by the customer service by construction.
  assert.match(read('src/services/crm/customerLeads.ts'), /organizationId === PLATFORM_TENANT\) throw/);
});

test('super-admin CRM untouched in SHARED files: every platform block identical to HEAD (only customer-CRM blocks differ)', async () => {
  const { execFileSync } = await import('node:child_process');
  const atHead = (f: string) => {
    try { return execFileSync('git', ['show', `HEAD:${f}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }); } catch { return null; }
  };
  /** Top-level declarations → their code, comment-only lines dropped. */
  const blocks = (src: string) => {
    const out = new Map<string, string>();
    let name = '__header__';
    let buf: string[] = [];
    for (const raw of src.replace(/\r\n/g, '\n').split('\n')) {
      const m = raw.match(/^(?:export )?(?:const|async function|function|let)\s+([A-Za-z0-9_]+)/);
      if (m) { out.set(name, (out.get(name) ?? '') + buf.join('\n')); name = m[1]; buf = []; }
      if (!/^\s*(\/\/|\/\*|\*)/.test(raw) && raw.trim()) buf.push(raw);
    }
    out.set(name, (out.get(name) ?? '') + buf.join('\n'));
    return out;
  };
  const allowed: Record<string, string[]> = {
    // + the GBP sync scheduler/worker (FR-3.2 → FR-3.6 GBP Intelligence) and the audit's
    //   bounded wait for the first GBP snapshot — not CRM code.
    'src/services/inngest/functions.ts': ['processFollowUpJob', 'scheduleLeadFollowUpsJob', 'dispatchWhatsappFollowUpJob', 'crmFollowUpReminderCron', 'crmStaleLeadReminderCron', 'crmGrowthReportReadyCron', 'gbpNightlySyncScheduler', 'gbpSyncWorker', 'generateAuditJob'],
    'src/app/api/whatsapp/webhook/route.ts': ['__header__', 'processInboundMessage'],
  };
  for (const [file, ok] of Object.entries(allowed)) {
    const head = atHead(file);
    if (head == null) return; // no git history available
    const a = blocks(head);
    const b = blocks(read(file));
    const changed = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k) && !ok.includes(k));
    assert.deepEqual(changed, [], `${file}: unexpected changes in ${changed.join(', ')}`);
  }
  // Platform-only fields/defaults the admin CRM depends on are unchanged.
  const lead = read('src/models/Lead.ts');
  assert.match(lead, /enum: \['Client Prospect', 'Platform Prospect'\],\s*default: 'Client Prospect'/);
  const headLead = atHead('src/models/Lead.ts');
  if (headLead) {
    const enumOf = (s: string) => (s.match(/source: \{\s*type: String,\s*enum: \[([^\]]+)\]/)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    for (const v of enumOf(headLead)) assert.ok(enumOf(lead).includes(v), `Lead.source value ${v} still valid`);
  }
  // processFollowUpJob still serves platform prospects (only non-platform leads are skipped).
  assert.match(read('src/services/inngest/functions.ts'), /if \(lead\.tenantId !== 'gmbboost-internal'\) return \{ skipped: true, reason: 'customer-crm-lead' \}/);
});

// ── Stage migration ──────────────────────────────────────────────────────

test('migration: legacy pipelineStage → canonical; converted flagged valueMissing; idempotent', () => {
  const cfg = resolveLeadStagesConfig(null);
  const when = new Date('2026-09-20T00:00:00Z');
  const a = planLeadStageMigration({ lifeCycleStage: 'initial', pipelineStage: 'Interested', updatedAt: when }, cfg);
  assert.deepEqual(a, { lifeCycleStage: 'active', subStage: 'Interested', subStageId: 'active-interested' });
  const b = planLeadStageMigration({ lifeCycleStage: 'initial', pipelineStage: 'Converted', updatedAt: when }, cfg)!;
  assert.equal(b.lifeCycleStage, 'converted');
  assert.deepEqual(b.deal, { value: null, currency: 'INR', closedAt: when, valueMissing: true });
  assert.ok(!('value' in b && typeof (b as any).deal.value === 'number'), 'no value invented');
  const c = planLeadStageMigration({ lifeCycleStage: 'active', subStage: 'Follow Up' }, cfg);
  assert.deepEqual(c, { subStageId: 'active-follow-up' });
  assert.equal(planLeadStageMigration({ lifeCycleStage: 'active', subStage: 'Follow Up', subStageId: 'active-follow-up' }, cfg), null);
  assert.equal(planLeadStageMigration({ lifeCycleStage: 'initial', pipelineStage: 'Inbound' }, cfg), null);
});

test('overdue reminder schedule: cron is UTC on Inngest and fires at 10:00 Asia/Kolkata', () => {
  const fns = read('src/services/inngest/functions.ts');
  const m = fns.match(/id: "crm-stale-lead-reminders", triggers: \[\{ cron: "([^"]+)" \}\]/);
  assert.ok(m, 'cron trigger found');
  const [min, hour] = m![1].split(' ').map(Number);
  // Inngest evaluates cron in UTC. Convert that UTC time to IST for several dates (no DST in India).
  for (const day of ['2026-01-15', '2026-04-01', '2026-07-15', '2026-10-25']) {
    const utc = new Date(`${day}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`);
    const ist = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(utc);
    assert.equal(ist, '10:00', `${day}: ${m![1]} UTC → ${ist} IST`);
  }
});
