/**
 * A free-report shadow account is "New User" until the owner types a name.
 * Until then the lead / WhatsApp threads use the business name; once they
 * give a name (checkout / profile), it replaces that fallback everywhere.
 *
 * Run: npx tsx --test tests/workflow/placeholder-person-name.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

for (const k of Object.keys(process.env)) if (/^(GROQ|OPENAI)_/.test(k)) delete process.env[k];
// salesAgent builds its Groq client at import; template mode never calls it.
process.env.GROQ_API_KEY = 'test-unused';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_placeholder_name_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Lead: (await import('../../src/models/Lead')).default,
    SalesConversation: (await import('../../src/models/SalesConversation')).default,
    BookingConversation: (await import('../../src/models/BookingConversation')).default,
    prospect: await import('../../src/services/leads/platformProspectEntry'),
  };
});

after(async () => {
  if (m.mongoose) await m.mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

test('free-report lead is filed under the business name, never "New User"', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { leadId } = await m.prospect.upsertPlatformProspectLead({ name: 'New User', phone: '+919800000001', businessName: 'Sharma Sweets' });
  const lead = await m.Lead.findById(leadId).lean();
  assert.equal(lead.name, 'Sharma Sweets');
});

test('a name given later replaces the business-name fallback on the lead and WhatsApp threads', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = '+919800000002';
  // businessType differs from the fallback name (e.g. a second workspace).
  await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Gupta Dental', phone, businessType: 'Gupta Clinic' });
  const businessId = new m.mongoose.Types.ObjectId();
  await m.SalesConversation.create({ businessId, leadPhone: phone, phoneKey: '9800000002', leadName: 'New User' });
  await m.BookingConversation.create({ leadPhone: phone, phoneKey: '9800000002', leadName: 'Gupta Dental', details: { name: 'Gupta Dental' } });

  await m.prospect.syncPlatformLeadName(phone, 'Anil Gupta', ['Gupta Clinic', 'Gupta Dental']);

  assert.equal((await m.Lead.findOne({ phone }).lean()).name, 'Anil Gupta');
  assert.equal((await m.SalesConversation.findOne({ leadPhone: phone }).lean()).leadName, 'Anil Gupta');
  const booking = await m.BookingConversation.findOne({ leadPhone: phone }).lean();
  assert.equal(booking.leadName, 'Anil Gupta');
  assert.equal(booking.details.name, 'Anil Gupta');
});

test('a real person name already on the lead is left alone', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = '+919800000003';
  await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Priya Rao', phone, businessType: 'Rao Bakery' });
  await m.prospect.syncPlatformLeadName(phone, 'Someone Else', ['Rao Bakery']);
  assert.equal((await m.Lead.findOne({ phone }).lean()).name, 'Priya Rao');
});

test('first WhatsApp message greets by business name, not "Hi New"', async () => {
  const { composeFirstMessage } = await import('../../src/services/sales/salesAgent');
  const { defaultSalesAgentConfig } = await import('../../src/lib/salesAgentDefaults');
  const config = defaultSalesAgentConfig();
  config.firstMessage.mode = 'template';
  config.firstMessage.template = 'Hi {{name}}';
  const scores: any = { businessName: 'Sharma Sweets', missingKeywords: [], verifiedIssues: [] };
  assert.equal(await composeFirstMessage(config, scores, 'New User'), 'Hi Sharma Sweets');
  assert.equal(await composeFirstMessage(config, scores, 'Sharma Sweets'), 'Hi Sharma Sweets');
  assert.equal(await composeFirstMessage(config, scores, 'Ramesh Sharma'), 'Hi Ramesh');
});
