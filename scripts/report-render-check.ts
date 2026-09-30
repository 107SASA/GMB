/**
 * Offline cross-surface check: renders the Free Report, Dashboard report, PDF
 * HTML and WhatsApp messages from a STORED audit (no provider calls, no DB)
 * and verifies they state the same key facts and never contain forbidden
 * phrases. Used on the auditData files the live check writes.
 *
 *   npx tsx scripts/report-render-check.ts <dir-with-*-auditData.json> [more dirs…]
 *
 * Exit code 1 when any surface disagrees or a forbidden phrase appears.
 */
import fs from 'node:fs';
import path from 'node:path';

// Some imported modules require these at load time; nothing here connects
// to a database or calls a provider.
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/offline-render-check';
process.env.GROQ_API_KEY ||= 'offline-render-check';

const FORBIDDEN = [
  '20+', 'losing customers', '4.2/week', '10–18', '10-18', 'Top 3 in 90 days', 'wheelchair accessible',
  'your GBP is missing', 'Google Business Profile is missing', 'Not Reflected on GBP', 'long titles are often flagged',
  'guaranteed', 'rank #1 in',
];
/** Fabricated ROI / predictions: a number attached to future customers or ranks. */
const FORBIDDEN_RE = [
  /\b\d+\s*(?:%|x|×)?\s*more\s+(?:calls|customers|leads|enquiries|visits|revenue)\b/i,
  /\b(?:week|month|day)\s*\d+\s*[:\-–]\s*#\d+/i,
  /\byou will (?:rank|get|receive)\b/i,
];

const strip = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

async function main() {
  const dirs = process.argv.slice(2);
  if (!dirs.length) throw new Error('usage: report-render-check.ts <dir> [dir…]');
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const FreeReportView = (await import('../src/components/audit/FreeReportView')).default;
  const AuditReportGrexa = (await import('../src/components/audit/AuditReportGrexa')).default;
  const { buildReportHtml } = await import('../src/lib/pdf/reportHtml');
  const { extractReportScores, composeSummaryMessage } = await import('../src/services/report/reportAgent');
  const { defaultReportAgentConfig } = await import('../src/lib/reportAgentDefaults');
  const { extractScores, composeFirstMessage } = await import('../src/services/sales/salesAgent');
  const { defaultSalesAgentConfig } = await import('../src/lib/salesAgentDefaults');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime' as string);
  const noop = () => {};
  const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, hmrRefresh: noop };
  const render = (el: any) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, el));

  let failures = 0;
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('-auditData.json'))) {
      const auditData = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const f = auditData.facts;
      const audit: any = { _id: 'offline', businessName: auditData.seoPlanDraft?.competitorLandscape ? 'Business' : 'Business', status: 'COMPLETED', fastMode: file.startsWith('free'), auditData, createdAt: new Date().toISOString() };
      const business = { rating: f?.reviews?.lifetime?.rating, reviewCount: f?.reviews?.lifetime?.totalCount };
      const surfaces: Record<string, string> = {
        free: strip(render(React.createElement(FreeReportView, { audit }))),
        dashboard: strip(render(React.createElement(AuditReportGrexa, { audit, onDownload: noop }))),
        pdf: strip(buildReportHtml({ audit, businessRating: business.rating } as any)),
      };
      const reportMsg = composeSummaryMessage(defaultReportAgentConfig(), extractReportScores(audit, business), 'Owner', 'https://example.invalid');
      const cfg = defaultSalesAgentConfig('https://example.invalid/billing', 'https://example.invalid/pricing');
      const salesMsg = await composeFirstMessage({ ...cfg, firstMessage: { ...cfg.firstMessage, mode: 'template' } } as any, extractScores(audit, business), 'Owner');
      surfaces.whatsapp = `${reportMsg}\n${salesMsg}`;

      // The same key facts on every surface that shows them.
      const expect: Array<[string, string, string[]]> = [];
      const lt = f?.reviews?.lifetime;
      if (lt?.totalCount != null) expect.push(['lifetime reviews', String(lt.totalCount), ['free', 'dashboard', 'pdf', 'whatsapp']]);
      const avg = f?.ranking?.overall?.averageObservedRank;
      if (avg != null) expect.push(['average rank where found', `#${avg}`, ['free', 'pdf']]);
      const pct = auditData.profileCompletion?.completionPercentage;
      if (pct != null) expect.push(['profile completion', `${Math.round(pct)}%`, ['free', 'dashboard', 'pdf']]);
      const out: string[] = [];
      for (const [label, needle, where] of expect) {
        for (const s of where) {
          if (!surfaces[s].includes(needle)) { out.push(`MISMATCH ${label}: "${needle}" not on ${s}`); failures++; }
        }
      }
      for (const [s, text] of Object.entries(surfaces)) {
        for (const p of FORBIDDEN) {
          const i = text.toLowerCase().indexOf(p.toLowerCase());
          if (i !== -1) { out.push(`FORBIDDEN on ${s}: "${p}" … ${text.slice(Math.max(0, i - 50), i + 60)}`); failures++; }
        }
        for (const re of FORBIDDEN_RE) {
          const m = text.match(re);
          if (m) { out.push(`FORBIDDEN on ${s}: ${re} … ${text.slice(Math.max(0, (m.index ?? 0) - 50), (m.index ?? 0) + 70)}`); failures++; }
        }
      }
      console.log(`${path.basename(dir)}/${file}: ${out.length ? `${out.length} problem(s)` : 'OK'} — checked ${expect.length} facts on ${Object.keys(surfaces).length} surfaces`);
      for (const line of out) console.log(`  ${line}`);
    }
  }
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('[render-check] FAILED:', e);
  process.exit(1);
});
