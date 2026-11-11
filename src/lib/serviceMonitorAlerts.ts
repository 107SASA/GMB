import dbConnect from '@/lib/mongodb';
import ServiceAccount, { type IServiceAccount } from '@/models/ServiceAccount';
import type { ServiceReport, ServiceStatus } from '@/lib/serviceMonitor';

const RANK: Record<string, number> = { critical: 5, error: 4, warning: 3, unconfigured: 2, ok: 1, info: 0 };
const ALERTING = new Set<ServiceStatus>(['critical', 'error', 'warning']);
const REPEAT_CRITICAL_MS = 24 * 60 * 60 * 1000;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * Emails one digest to ADMIN_EMAIL for services that got worse since the last
 * alert (or are still critical a day later), plus ones that recovered.
 */
export async function alertOnServiceChanges(reports: ServiceReport[]) {
  await dbConnect();
  const accounts = await ServiceAccount.find({ key: { $in: reports.map((r) => r.key) } }).lean<IServiceAccount[]>();
  const byKey = new Map(accounts.map((a) => [a.key, a]));
  const now = Date.now();

  const worse: ServiceReport[] = [];
  const recovered: ServiceReport[] = [];
  for (const r of reports) {
    const acc = byKey.get(r.key);
    if (acc?.alertsMuted) continue;
    const prev = (acc?.lastAlertedStatus || 'ok') as ServiceStatus;
    const lastAt = acc?.lastAlertedAt ? new Date(acc.lastAlertedAt).getTime() : 0;
    if (ALERTING.has(r.status)) {
      const gotWorse = RANK[r.status] > RANK[prev];
      const stillCritical = r.status === 'critical' && now - lastAt >= REPEAT_CRITICAL_MS;
      if (gotWorse || stillCritical) worse.push(r);
    } else if (ALERTING.has(prev)) {
      recovered.push(r);
    }
  }

  if (!worse.length && !recovered.length) return { sent: false, worse: 0, recovered: 0 };

  const to = process.env.ADMIN_EMAIL;
  let sent = false;
  if (to) {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://growwmatics.com').replace(/\/$/, '');
    const color = (s: ServiceStatus) => (s === 'warning' ? '#b45309' : '#b91c1c');
    const rows = worse
      .sort((a, b) => RANK[b.status] - RANK[a.status])
      .map((r) => `<tr><td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top"><b>${esc(r.name)}</b><br/><span style="color:${color(r.status)};font-size:12px;font-weight:bold">${r.status.toUpperCase()}</span></td><td style="padding:8px;border-bottom:1px solid #eee">${esc(r.summary)}${r.dashboardUrl ? `<br/><a href="${r.dashboardUrl}">Open ${esc(r.name.split(' (')[0])}</a>` : ''}</td></tr>`)
      .join('');
    const ok = recovered.length ? `<p style="color:#15803d">Back to normal: ${recovered.map((r) => esc(r.name)).join(', ')}.</p>` : '';
    const critical = worse.filter((r) => r.status === 'critical' || r.status === 'error').length;
    const subject = worse.length
      ? `${critical ? '🔴' : '🟠'} ${worse.length} service${worse.length > 1 ? 's' : ''} need${worse.length > 1 ? '' : 's'} attention: ${worse.map((r) => r.name.split(' (')[0]).join(', ')}`
      : `✅ Services back to normal: ${recovered.map((r) => r.name.split(' (')[0]).join(', ')}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 12px">Services &amp; Costs</h2>
      ${rows ? `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>` : ''}
      ${ok}
      <p><a href="${appUrl}/admin/services">Open Services &amp; Costs →</a></p>
    </div>`;
    const { sendTransactionalEmail } = await import('@/services/email');
    const res = await sendTransactionalEmail(to, subject, html);
    sent = Boolean(res.success);
    if (!sent) console.error('[service-monitor] alert email failed:', (res as any).error);
  } else {
    console.warn('[service-monitor] ADMIN_EMAIL not set — service alerts are only visible in /admin/services.');
  }

  // Record what was alerted even without email, so the badge/state stays consistent
  // and a missing ADMIN_EMAIL does not cause a flood once it is set.
  if (sent || !to) {
    await ServiceAccount.bulkWrite([
      ...worse.map((r) => ({ updateOne: { filter: { key: r.key }, update: { $set: { lastAlertedStatus: r.status, lastAlertedAt: new Date() } }, upsert: true } })),
      ...recovered.map((r) => ({ updateOne: { filter: { key: r.key }, update: { $set: { lastAlertedStatus: r.status }, $unset: { lastAlertedAt: 1 as const } } } })),
    ]);
  }
  return { sent, worse: worse.length, recovered: recovered.length };
}
