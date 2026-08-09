// Verifies the REAL end-to-end dispatch path: creates a PENDING audit via
// createPendingAuditAndDispatch (the exact function /api/free-report/start
// calls) and polls to see whether Inngest actually picks it up and
// completes it — WITHOUT calling processAuditJob directly. This is the
// thing that was actually broken (a hung dev server -> Inngest couldn't
// sync -> events never dispatched), not the audit-generation logic itself.
//
// Run: npx tsx scripts/verify_inngest_dispatch.ts

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

async function main() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  const Business = (await import('../src/models/Business')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const User = (await import('../src/models/User')).default;
  const Audit = (await import('../src/models/Audit')).default;
  const { createPendingAuditAndDispatch } = await import('../src/lib/startAudit');

  await dbConnect();

  const user = await User.create({
    fullName: 'Verify Inngest', email: `verify-inngest-${Date.now()}@shadow.growwmatics.internal`,
    phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`, role: 'CLIENT',
    isShadowAccount: true, shadowSource: 'verify-script', isEmailVerified: false,
  });
  const organization = await Organization.create({ name: 'Verify Inngest Org', ownerId: user._id, subscriptionPlan: 'Free' });
  const business = await Business.create({
    name: 'Verify Inngest Business', category: 'Test', address: 'Test', city: 'Test',
    organizationId: organization._id, userId: user._id, provisionedVia: 'verify-script',
  });

  console.log('Dispatching via createPendingAuditAndDispatch (real path, same as /api/free-report/start)...');
  const audit = await createPendingAuditAndDispatch(business, organization, user);
  console.log(`Audit ${audit._id} created as PENDING. Polling for Inngest to pick it up...`);

  const start = Date.now();
  const timeoutMs = 45_000;
  let finalStatus = 'PENDING';
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const current: any = await Audit.findById(audit._id).lean();
    process.stdout.write('.');
    if (current.status !== 'PENDING') {
      finalStatus = current.status;
      console.log(`\nStatus changed to ${current.status} after ${Math.round((Date.now() - start) / 1000)}s`);
      break;
    }
  }

  if (finalStatus === 'PENDING') {
    console.log(`\n❌ Still PENDING after ${timeoutMs / 1000}s — Inngest did NOT pick up the event.`);
  } else {
    console.log(`✅ Inngest dispatch works — audit reached status "${finalStatus}" without any manual intervention.`);
  }

  await Audit.deleteMany({ businessId: business._id });
  await Business.deleteOne({ _id: business._id });
  await Organization.deleteOne({ _id: organization._id });
  await User.deleteOne({ _id: user._id });

  process.exit(finalStatus === 'PENDING' ? 1 : 0);
}

main().catch((e) => { console.error('SCRIPT CRASHED:', e); process.exit(1); });
