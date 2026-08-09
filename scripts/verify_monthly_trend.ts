// Verifies the monthlyTrend aggregation added to /api/gbp/insights — seeds
// GBPInsights rows across 3 different months and checks correct bucketing
// (grouped by year-month, summed per field, sorted oldest→newest).
//
// Run: npx tsx scripts/verify_monthly_trend.ts

import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1].trim() in process.env)) process.env[m[1].trim()] = v;
}

let pass = 0, fail = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) { console.log(`✅ ${label}`); pass++; }
  else { console.log(`❌ ${label}`, detail ?? ''); fail++; }
}

async function main() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  const Business = (await import('../src/models/Business')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const User = (await import('../src/models/User')).default;
  const GBPInsights = (await import('../src/models/GBPInsights')).default;

  await dbConnect();

  const user = await User.create({
    fullName: 'Verify Trend', email: `verify-trend-${Date.now()}@shadow.growwmatics.internal`,
    phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`, role: 'CLIENT',
    isShadowAccount: true, shadowSource: 'verify-script', isEmailVerified: false,
  });
  const organization = await Organization.create({ name: 'Verify Trend Org', ownerId: user._id, subscriptionPlan: 'Free' });
  const business = await Business.create({
    name: 'Verify Trend Business', category: 'Test', address: 'Test', city: 'Test',
    organizationId: organization._id, userId: user._id, provisionedVia: 'verify-script',
  });

  // 3 rows in month M-2, 2 rows in month M-1, 1 row in month M (this month).
  // Dates built as bare "YYYY-MM-DD" strings — matches exactly how the real
  // sync job stores them (gbpClient.ts fetchDailyMetrics -> dateKey), which
  // JS parses as UTC midnight (safe). An earlier version of this script used
  // `new Date(year, month, day)` (local-timezone constructor) instead, which
  // drifted across the UTC boundary near month edges and produced wrong
  // buckets — that was a bug in the TEST's seeding, not the route; keeping
  // this note so nobody "fixes" it back to the broken form.
  const now = new Date();
  const mk = (monthsAgo: number, day: number, views: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1); // to read the right year/month
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { businessId: business._id, organizationId: organization._id, date: new Date(dateKey), views, callClicks: 1, directionRequests: 1 };
  };
  await GBPInsights.insertMany([
    mk(2, 1, 100), mk(2, 2, 100), mk(2, 3, 100), // month M-2: sum views = 300
    mk(1, 1, 50), mk(1, 2, 50),                   // month M-1: sum views = 100
    mk(0, 1, 10),                                  // month M: sum views = 10
  ]);

  try {
    // Replicate the exact aggregation logic from the route.
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthRows = await GBPInsights.find({ businessId: business._id, date: { $gte: sixMonthsAgo } }).lean();
    const monthBuckets = new Map<string, { views: number; callClicks: number; directionRequests: number }>();
    for (const r of monthRows as any[]) {
      const key = r.date.toISOString().slice(0, 7);
      const bucket = monthBuckets.get(key) ?? { views: 0, callClicks: 0, directionRequests: 0 };
      bucket.views += r.views ?? 0;
      bucket.callClicks += r.callClicks ?? 0;
      bucket.directionRequests += r.directionRequests ?? 0;
      monthBuckets.set(key, bucket);
    }
    const monthlyTrend = [...monthBuckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, totals]) => ({ month: new Date(`${key}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short' }), ...totals }));

    check('3 monthly buckets produced', monthlyTrend.length === 3, monthlyTrend);
    check('Oldest→newest order (M-2 first)', monthlyTrend[0].views === 300, monthlyTrend[0]);
    check('Middle month summed correctly (100)', monthlyTrend[1].views === 100, monthlyTrend[1]);
    check('Most recent month summed correctly (10)', monthlyTrend[2].views === 10, monthlyTrend[2]);
    check('callClicks summed correctly for M-2 (3 rows × 1)', monthlyTrend[0].callClicks === 3, monthlyTrend[0]);
  } finally {
    await GBPInsights.deleteMany({ businessId: business._id });
    await Business.deleteOne({ _id: business._id });
    await Organization.deleteOne({ _id: organization._id });
    await User.deleteOne({ _id: user._id });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('VERIFY SCRIPT CRASHED:', e); process.exit(1); });
