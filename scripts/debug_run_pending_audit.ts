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

const auditId = process.argv[2];
if (!auditId) {
  console.error('Usage: npx tsx scripts/debug_run_pending_audit.ts <auditId>');
  process.exit(1);
}

async function main() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  await dbConnect();
  const { processAuditJob } = await import('../src/services/audit/auditService');
  const Audit = (await import('../src/models/Audit')).default;

  console.log(`Running processAuditJob(${auditId}) directly...`);
  try {
    await processAuditJob(auditId);
    console.log('processAuditJob resolved without throwing.');
  } catch (e) {
    console.error('processAuditJob THREW:', e);
  }

  const after: any = await Audit.findById(auditId).lean();
  console.log('\n=== RESULT ===');
  console.log('status:', after?.status);
  console.log('overallScore:', after?.overallScore);
  console.log('metadata:', JSON.stringify(after?.metadata));
  console.log('reviewAnalysis:', JSON.stringify(after?.auditData?.reviewAnalysis));
  console.log('profileCompletion:', JSON.stringify(after?.auditData?.profileCompletion));
  process.exit(0);
}

main().catch((e) => {
  console.error('SCRIPT CRASHED:', e);
  process.exit(1);
});
