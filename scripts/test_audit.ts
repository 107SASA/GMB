import mongoose from 'mongoose';
import { processAuditJob } from '../src/services/audit/auditService';
import Audit from '../src/models/Audit';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log('Connected to DB');

  const latestAudit = await Audit.findOne({ status: 'PENDING' }).sort({ createdAt: -1 });
  if (!latestAudit) {
    console.log('No PENDING audits found.');
    process.exit(0);
  }

  console.log('Running processAuditJob for Audit ID:', latestAudit._id);
  try {
    await processAuditJob(latestAudit._id.toString());
    console.log('Success!');
  } catch (error) {
    console.error('Audit failed with error:', error);
  }
  process.exit(0);
}
run();
