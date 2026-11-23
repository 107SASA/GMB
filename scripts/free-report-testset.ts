/**
 * Free report test set (docs/FREE_REPORT_REBUILD_PLAN.md Part C.5 step 1).
 * Makes fresh free reports for a fixed list of real businesses with the code
 * in this checkout, and compares them with the previous run — so a change is
 * checked across trades before it goes to main.
 *
 *   npx tsx scripts/free-report-testset.ts --pick [--per-group 2]
 *       Writes scripts/testset/businesses.json: recent free reports, one or
 *       two per industry group (Food and Drink, Lodging, Health and Wellness,
 *       ...). Edit the file by hand to add / remove businesses.
 *   npx tsx scripts/free-report-testset.ts --run [--only <businessId>]
 *       Makes a new report for every business in the list and saves a
 *       summary to scripts/testset/run-<timestamp>.json, then prints what
 *       changed since the previous run (keywords, ranks, areas, competitors,
 *       issues).
 *
 * Safe for customers: no WhatsApp, no Inngest event (both are stubbed for the
 * whole run), and free reports send nothing themselves. Each run still adds
 * a new (latest) report to each business and costs about ₹50 per business
 * in Google / DataForSEO data.
 * Env: .env.production if present, else .env.local.
 */
import fs from 'fs';
import path from 'path';

for (const f of ['.env.production', '.env.local']) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1].trim() in process.env)) process.env[m[1].trim()] = v;
  }
  console.log(`(env from ${f})`);
  break;
}

const DIR = path.resolve(process.cwd(), 'scripts/testset');
const LIST = path.join(DIR, 'businesses.json');
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

interface Entry { businessId: string; name: string; group: string; city: string }

async function pick() {
  const Audit = (await import('../src/models/Audit')).default;
  const Business = (await import('../src/models/Business')).default;
  const perGroup = Number(opt('--per-group') || 1);
  const audits: any[] = await Audit.find({ fastMode: true, status: 'COMPLETED' })
    .sort({ createdAt: -1 }).limit(600)
    .select('businessId auditData.facts.understanding.industry auditData.facts.category.used').lean();
  const byGroup = new Map<string, Entry[]>();
  const seen = new Set<string>();
  for (const a of audits) {
    const id = String(a.businessId || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const group = a.auditData?.facts?.understanding?.industry || `(category) ${a.auditData?.facts?.category?.used || 'unknown'}`;
    const list = byGroup.get(group) || [];
    if (list.length >= perGroup) continue;
    const b: any = await Business.findById(id).select('name city').lean();
    if (!b) continue;
    list.push({ businessId: id, name: b.name, group, city: b.city || '' });
    byGroup.set(group, list);
  }
  const entries = Array.from(byGroup.values()).flat();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(LIST, JSON.stringify(entries, null, 2));
  console.log(`${entries.length} businesses in ${byGroup.size} groups → ${path.relative(process.cwd(), LIST)}`);
  for (const [g, l] of byGroup) console.log(`  ${g}: ${l.map((e) => e.name).join(', ')}`);
}

function summarize(a: any) {
  const d = a?.auditData || {};
  const f = d.facts || {};
  const rankOf = new Map<string, any>((f.ranking?.byKeyword || []).map((k: any) => [String(k.keyword).toLowerCase(), k]));
  const rank = (kw: string) => {
    const r = rankOf.get(kw.toLowerCase());
    if (!r || r.status === 'unavailable' || !r.testedCount) return 'not measured';
    return r.foundCount > 0 ? `#${Math.round(r.averageObservedRank * 10) / 10}` : 'not in top 20';
  };
  const av = f.areaVisibility;
  return {
    auditId: String(a._id),
    status: a.status,
    logicVersion: d.logicVersion ?? null,
    trade: f.understanding?.trade ?? null,
    servedHow: f.understanding?.servedHow ?? null,
    keywords: (f.understanding?.keywordsPicked || []).map((k: any) => ({ keyword: k.keyword, volume: k.volume ?? null, rank: rank(k.keyword) })),
    keywordResearch: f.understanding?.keywordResearch ?? null,
    areas: (av?.areas || []).map((x: any) => ({ area: x.area, status: x.status, best: x.bestRank ?? null })),
    competitorsAbove: (f.competitorsAhead?.names || []).slice(0, 5),
    issues: (d.findings || []).filter((x: any) => x.category !== 'data_quality' && !x.verificationOnly).map((x: any) => x.title),
    timings: f.timings ?? null,
  };
}

async function runSet() {
  if (!fs.existsSync(LIST)) throw new Error(`No list yet — run with --pick first (${LIST})`);
  let entries: Entry[] = JSON.parse(fs.readFileSync(LIST, 'utf-8'));
  const only = opt('--only');
  if (only) entries = entries.filter((e) => e.businessId === only);

  const { inngest } = await import('../src/services/inngest/client');
  (inngest as any).send = async () => ({ ids: [] }); // nothing leaves this run
  const Business = (await import('../src/models/Business')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const User = (await import('../src/models/User')).default;
  const Audit = (await import('../src/models/Audit')).default;
  const { createPendingAuditAndDispatch } = await import('../src/lib/startAudit');
  const { processAuditJob } = await import('../src/services/audit/auditService');

  const results: Record<string, any> = {};
  for (const e of entries) {
    const t0 = Date.now();
    process.stdout.write(`${e.group} · ${e.name} … `);
    try {
      const business: any = await Business.findById(e.businessId);
      const organization = business && await Organization.findById(business.organizationId);
      const user: any = business && await User.findOne({ businessIds: business._id, role: { $ne: 'super_admin' } });
      if (!business || !organization || !user) throw new Error('business / organization / user not found');
      const audit = await createPendingAuditAndDispatch(business, organization, user, { trigger: 'admin-regenerate' });
      await processAuditJob(String(audit._id));
      const after: any = await Audit.findById(audit._id).lean();
      results[e.businessId] = { name: e.name, group: e.group, ...summarize(after) };
      console.log(`${after?.status} in ${Math.round((Date.now() - t0) / 1000)} s`);
    } catch (err: any) {
      results[e.businessId] = { name: e.name, group: e.group, error: err?.message || String(err) };
      console.log(`FAILED: ${err?.message}`);
    }
  }

  fs.mkdirSync(DIR, { recursive: true });
  const prevFile = fs.readdirSync(DIR).filter((f) => /^run-.*\.json$/.test(f)).sort().pop();
  const file = path.join(DIR, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`\nSaved ${path.relative(process.cwd(), file)}`);

  const prev: Record<string, any> = prevFile ? JSON.parse(fs.readFileSync(path.join(DIR, prevFile), 'utf-8')) : {};
  console.log(prevFile ? `Compared with ${prevFile}:\n` : 'First run — nothing to compare yet.\n');
  for (const [id, r] of Object.entries(results)) {
    console.log(`■ ${r.name} (${r.group})${r.error ? ` — FAILED: ${r.error}` : ''}`);
    if (r.error) continue;
    const p = prev[id];
    console.log(`  trade: ${r.trade ?? '-'} · served: ${r.servedHow ?? '-'} · v${r.logicVersion ?? '?'}`);
    console.log(`  keywords: ${r.keywords.map((k: any) => `${k.keyword} [${k.volume ?? '—'}/mo, ${k.rank}]`).join(' | ') || '(none)'}`);
    if (p?.keywords) {
      const before = new Set(p.keywords.map((k: any) => k.keyword));
      const now = new Set(r.keywords.map((k: any) => k.keyword));
      const added = [...now].filter((k) => !before.has(k));
      const removed = [...before].filter((k) => !now.has(k as string));
      if (added.length || removed.length) console.log(`  keyword changes: +${added.join(', ') || '-'}  −${removed.join(', ') || '-'}`);
    }
    if (r.areas.length) console.log(`  areas: ${r.areas.map((a: any) => `${a.area} ${a.status === 'measured' ? (a.best ? `#${a.best}` : 'not in top 20') : a.status}`).join(' | ')}`);
    console.log(`  competitors above: ${r.competitorsAbove.join(', ') || '(none)'}`);
    console.log(`  issues (${r.issues.length}): ${r.issues.join(' · ') || '(none)'}`);
    if (p && !p.error && p.issues) {
      const gone = p.issues.filter((x: string) => !r.issues.includes(x));
      const fresh = r.issues.filter((x: string) => !p.issues.includes(x));
      if (gone.length || fresh.length) console.log(`  issue changes: +${fresh.join(' · ') || '-'}  −${gone.join(' · ') || '-'}`);
    }
  }
}

async function main() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  await dbConnect();
  if (flag('--pick')) await pick();
  else if (flag('--run')) await runSet();
  else {
    console.log('Usage: npx tsx scripts/free-report-testset.ts --pick [--per-group 2] | --run [--only <businessId>]');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e?.message || e);
  process.exit(1);
});
