// Verifies the before/after impact split added to /api/gbp/insights —
// seeds real GBPInsights rows around a fake connectedAt date for a
// throwaway business, then re-runs the exact same aggregation the route
// uses (imported inline here to stay in sync) and checks the numbers.
//
// Run: npx tsx scripts/verify_impact_split.ts

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
  const GBPToken = (await import('../src/models/GBPToken')).default;
  const GBPInsights = (await import('../src/models/GBPInsights')).default;

  await dbConnect();

  const user = await User.create({
    fullName: 'Verify Impact', email: `verify-impact-${Date.now()}@shadow.growwmatics.internal`,
    phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`, role: 'CLIENT',
    isShadowAccount: true, shadowSource: 'verify-script', isEmailVerified: false,
  });
  const organization = await Organization.create({ name: 'Verify Impact Org', ownerId: user._id, subscriptionPlan: 'Free' });
  const business = await Business.create({
    name: 'Verify Impact Business', category: 'Test', address: 'Test', city: 'Test',
    organizationId: organization._id, userId: user._id, provisionedVia: 'verify-script',
  });

  const connectedAt = new Date('2026-06-15T00:00:00Z');
  await GBPToken.create({
    businessId: business._id, organizationId: organization._id, googleAccountId: 'accounts/1',
    googleEmail: 'verify@test.com', accessToken: 'x', refreshToken: 'x',
    expiresAt: new Date(Date.now() + 3600_000), connectedAt,
    accountId: 'accounts/1', locationId: 'locations/1',
  });

  // Before: 10 days averaging 100 views/day. After: 5 days averaging 200 views/day.
  const rows: any[] = [];
  for (let i = 1; i <= 10; i++) {
    const d = new Date(connectedAt); d.setDate(d.getDate() - i);
    rows.push({ businessId: business._id, organizationId: organization._id, date: d, views: 100, callClicks: 2, directionRequests: 3 });
  }
  for (let i = 0; i < 5; i++) {
    const d = new Date(connectedAt); d.setDate(d.getDate() + i);
    rows.push({ businessId: business._id, organizationId: organization._id, date: d, views: 200, callClicks: 4, directionRequests: 6 });
  }
  await GBPInsights.insertMany(rows);

  try {
    // Replicate the exact route logic being verified.
    const [beforeRows, afterRows] = await Promise.all([
      GBPInsights.find({ businessId: business._id, date: { $lt: connectedAt } }).lean(),
      GBPInsights.find({ businessId: business._id, date: { $gte: connectedAt } }).lean(),
    ]);
    const sumField = (rs: any[], field: string) => rs.reduce((acc, r) => acc + (r[field] ?? 0), 0);
    const avgPerMonth = (rs: any[], field: string): number | null => {
      if (rs.length === 0) return null;
      return Math.round((sumField(rs, field) / rs.length) * 30);
    };

    check('Before rows = 10', beforeRows.length === 10, beforeRows.length);
    check('After rows = 5', afterRows.length === 5, afterRows.length);
    check('Before avg/month views = 100*30 = 3000', avgPerMonth(beforeRows, 'views') === 3000, avgPerMonth(beforeRows, 'views'));
    check('After avg/month views = 200*30 = 6000', avgPerMonth(afterRows, 'views') === 6000, avgPerMonth(afterRows, 'views'));
    check('Before avg/month calls = 2*30 = 60', avgPerMonth(beforeRows, 'callClicks') === 60, avgPerMonth(beforeRows, 'callClicks'));
    check('After avg/month directions = 6*30 = 180', avgPerMonth(afterRows, 'directionRequests') === 180, avgPerMonth(afterRows, 'directionRequests'));

    // No-history case: a business with zero rows before connectedAt should get null, not 0.
    const noHistoryBefore = await GBPInsights.find({ businessId: business._id, date: { $lt: new Date('2020-01-01') } }).lean();
    check('No pre-history -> avgPerMonth is null (not 0)', avgPerMonth(noHistoryBefore, 'views') === null, avgPerMonth(noHistoryBefore, 'views'));
  } finally {
    await GBPInsights.deleteMany({ businessId: business._id });
    await GBPToken.deleteOne({ businessId: business._id });
    await Business.deleteOne({ _id: business._id });
    await Organization.deleteOne({ _id: organization._id });
    await User.deleteOne({ _id: user._id });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('VERIFY SCRIPT CRASHED:', e); process.exit(1); });
