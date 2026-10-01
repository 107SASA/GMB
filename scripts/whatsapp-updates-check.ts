/**
 * Owner WhatsApp updates on a throwaway in-memory MongoDB:
 * 15-day Google performance update (sent once per 15 days, never twice),
 * weekly "no new reviews" reminder, opt-out respected.
 *   npx tsx scripts/whatsapp-updates-check.ts
 * WhatsApp is NEVER sent — sendOutboundMessage is intercepted and captured.
 * No provider calls: everything reads stored data.
 */
import fs from 'fs';
import path from 'path';

for (const file of ['.env.local', '.env']) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) continue;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2]; if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, ''); v = v.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];
process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.invalid';

const whatsapp: Array<{ phone: string; body: string }> = [];
let intercepted = false;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/services[\\/]whatsapp[\\/]send(\.ts)?$/.test(request)) {
    intercepted = true;
    const sendOutboundMessage = async (phone: string, body: string) => { whatsapp.push({ phone, body }); return { success: true, sid: 'captured' }; };
    return { __esModule: true, sendOutboundMessage, default: { sendOutboundMessage } };
  }
  return origLoad.call(this, request, ...rest);
};

const results: Array<{ t: string; pass: boolean }> = [];
const check = (t: string, what: string, pass: boolean, detail: string) => { results.push({ t, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  [${t}] ${what} — ${detail}`); };

(async () => {
  const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  process.env.MONGODB_URI = mem.getUri('wa_updates_check');
  try {
    const mongoose = (await import('mongoose')).default;
    const dbConnect = (await import('../src/lib/mongodb')).default; await dbConnect();
    const { default: User } = await import('../src/models/User');
    const { default: Business } = await import('../src/models/Business');
    const { default: GBPInsights } = await import('../src/models/GBPInsights');
    const { sendPerformanceDigest, runPerformanceDigestAll, runWeeklyMonitoring } = await import('../src/services/lifecycle/notify');

    const org = new mongoose.Types.ObjectId();
    const user: any = await User.create({ fullName: 'Owner', email: 'owner@example.invalid', phone: '+919999900003', role: 'CLIENT' });
    const biz: any = await Business.create({ name: 'Mulsetu', category: 'Software company', address: 'Ojhar, Nashik', organizationId: org, userId: user._id,
      subscriptionStatus: 'active', googleConnected: true, googlePlaceId: 'ChIJtestplace', googleReviewTotals: { rating: 5, total: 3, capturedAt: new Date() } });
    const now = new Date('2026-10-01T05:00:00Z');
    const edge = Date.UTC(2026, 9, 1) - 3 * 86_400_000;
    await GBPInsights.insertMany(Array.from({ length: 30 }, (_, i) => ({
      businessId: biz._id, organizationId: org, date: new Date(edge - (i + 1) * 86_400_000),
      ...(i < 15 ? { views: 3, viewsSearch: 2, viewsMaps: 1, directionRequests: 2 } : { views: 2, viewsSearch: 2, websiteClicks: 1 }),
    })));

    // 15-day update.
    const r1 = await runPerformanceDigestAll(now);
    const d1 = whatsapp.filter((w) => /last 15 days/.test(w.body));
    check('P1', 'due business gets one 15-day Google performance update', r1.sent === 1 && d1.length === 1 && /Total views: 45 \(\+50%/.test(d1[0].body) && !/revenue|₹|ROI/i.test(d1[0].body), d1[0]?.body.split('\n').slice(0, 4).join(' / ') || 'none');
    await runPerformanceDigestAll(now);
    const twice = await sendPerformanceDigest(String(biz._id), new Date(now.getTime() + 2 * 86_400_000));
    check('P2', 'no duplicate: rerun the same day and 2 days later → not sent again', whatsapp.filter((w) => /last 15 days/.test(w.body)).length === 1 && twice.status === 'not_due', `second call: ${twice.status}`);
    const later = await sendPerformanceDigest(String(biz._id), new Date(now.getTime() + 15 * 86_400_000));
    check('P3', '15 days later → next update is due', later.status === 'sent_if_opted_in' || later.status === 'not_enough_data', later.status);

    // Opt-out.
    await User.updateOne({ _id: user._id }, { $set: { 'notificationPreferences.performanceDigestWhatsApp': false } });
    await Business.updateOne({ _id: biz._id }, { $unset: { performanceDigestLastSentAt: 1 } });
    const before = whatsapp.length;
    await sendPerformanceDigest(String(biz._id), now);
    check('P4', 'owner turned the 15-day update off → nothing sent', whatsapp.length === before, `messages ${whatsapp.length - before}`);

    // Weekly: no new reviews this week → WhatsApp reminder with the review link.
    const before2 = whatsapp.length;
    const w = await runWeeklyMonitoring(String(biz._id), now);
    const rem = whatsapp.slice(before2).find((x) => /No new Google reviews/.test(x.body));
    check('W1', 'weekly: no new reviews → WhatsApp reminder with the real review link (once per week)', !!rem && /writereview\?placeid=ChIJtestplace/.test(rem.body), `${w.status} / ${w.whatsapp} · ${rem?.body.split('\n')[0] ?? 'none'}`);
    const again = await runWeeklyMonitoring(String(biz._id), now);
    check('W2', 'weekly rerun the same week → no second reminder', again.status === 'already_ran' && whatsapp.filter((x) => /No new Google reviews/.test(x.body)).length === 1, again.status);

    check('safety', 'WhatsApp intercepted — nothing delivered', intercepted, `captured ${whatsapp.length}`);
  } finally {
    await mem.stop({ doCleanup: true, force: true }).catch(() => {});
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.t).join(', ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
