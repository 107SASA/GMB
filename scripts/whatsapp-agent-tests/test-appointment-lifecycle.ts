/**
 * DB-integration test for the WhatsApp AI Agent appointment lifecycle.
 * Requires a real MongoDB connection (uses MONGODB_URI from the environment,
 * same as the rest of the app — does NOT hardcode credentials).
 *
 * Run with:
 *   MONGODB_URI="<your dev/staging URI>" npx tsx scripts/whatsapp-agent-tests/test-appointment-lifecycle.ts
 *
 * Creates and cleans up its own throwaway Business/Lead/Appointment docs
 * (prefixed with __WA_TEST__) — never touches real tenant data. Safe to run
 * against a dev database; NOT intended to run against production.
 */
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import Business from '../../src/models/Business';
import Lead from '../../src/models/Lead';
import WhatsAppAppointment from '../../src/models/WhatsAppAppointment';
import {
  bookAppointment,
  cancelAppointment,
  findActiveAppointmentForLead,
  isSlotTaken,
  rescheduleAppointment,
} from '../../src/services/whatsapp-agent/appointmentService';
import { resolveWorkingHoursConfig } from '../../src/services/whatsapp-agent/businessHours';

const MONGODB_URI = process.env.MONGODB_URI;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e: any) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${e.message}`);
  }
}

async function run() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Skipping DB-integration tests (this is expected in sandboxes without DB network access).');
    process.exit(0);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to DB');

  const org = new mongoose.Types.ObjectId();
  const business = await Business.create({
    name: '__WA_TEST__ Business',
    category: 'Test',
    address: '123 Test St',
    organizationId: org,
    whatsappBookingSettings: {
      bookingEnabled: true,
      timezone: 'Asia/Kolkata',
      workingDays: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: false },
      openingTime: '09:00',
      closingTime: '18:00',
      slotDurationMinutes: 30,
    },
  });

  const lead = await Lead.create({
    tenantId: org.toString(),
    businessId: business._id,
    name: '__WA_TEST__ Customer',
    phone: '+911234500000',
    source: 'WhatsApp',
  });

  const config = resolveWorkingHoursConfig(business.whatsappBookingSettings);

  // Pick a definitely-valid future Monday slot.
  function nextMonday(): string {
    const d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return d.toISOString().slice(0, 10);
  }
  const slotDate = nextMonday();

  try {
    let createdAppointmentId: string | null = null;

    await test('bookAppointment succeeds for a valid, open slot', async () => {
      const result = await bookAppointment(config, {
        tenantId: org.toString(),
        businessId: business._id.toString(),
        leadId: lead._id.toString(),
        customerName: '__WA_TEST__ Customer',
        phone: '+911234500000',
        date: slotDate,
        time: '15:00',
        timezone: config.timezone,
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      if (result.ok) createdAppointmentId = result.appointment._id.toString();
    });

    await test('isSlotTaken reflects the newly booked slot', async () => {
      const taken = await isSlotTaken(business._id.toString(), slotDate, '15:00');
      assert.equal(taken, true);
    });

    await test('bookAppointment rejects a double-booking of the same slot and suggests alternatives', async () => {
      const result = await bookAppointment(config, {
        tenantId: org.toString(),
        businessId: business._id.toString(),
        leadId: lead._id.toString(),
        customerName: 'Someone Else',
        phone: '+911234500001',
        date: slotDate,
        time: '15:00',
        timezone: config.timezone,
      });
      assert.equal(result.ok, false);
      if (!result.ok && result.reason === 'slot_taken') {
        assert.ok(result.alternatives.length > 0);
        assert.ok(result.alternatives.every((a) => a.time !== '15:00' || a.date !== slotDate));
      } else {
        throw new Error(`expected slot_taken, got ${JSON.stringify(result)}`);
      }
    });

    await test('findActiveAppointmentForLead returns the booked appointment', async () => {
      const appt = await findActiveAppointmentForLead(lead._id.toString());
      assert.ok(appt);
      assert.equal(appt!.date, slotDate);
      assert.equal(appt!.time, '15:00');
    });

    await test('rescheduleAppointment moves the appointment and preserves history', async () => {
      assert.ok(createdAppointmentId);
      const result = await rescheduleAppointment(config, createdAppointmentId!, slotDate, '16:00', config.timezone);
      assert.equal(result.ok, true, JSON.stringify(result));
      if (result.ok) {
        assert.equal(result.appointment.time, '16:00');
        const historyActions = result.appointment.history.map((h) => h.action);
        assert.ok(historyActions.includes('created'));
        assert.ok(historyActions.includes('rescheduled'));
      }
    });

    await test('old slot (15:00) is freed up after reschedule', async () => {
      const taken = await isSlotTaken(business._id.toString(), slotDate, '15:00');
      assert.equal(taken, false);
    });

    await test('cancelAppointment sets status to Cancelled and never deletes the record', async () => {
      assert.ok(createdAppointmentId);
      const cancelled = await cancelAppointment(createdAppointmentId!, 'test cleanup');
      assert.ok(cancelled);
      assert.equal(cancelled!.status, 'Cancelled');
      const stillExists = await WhatsAppAppointment.findById(createdAppointmentId);
      assert.ok(stillExists, 'appointment must still exist in the collection after cancellation');
    });

    await test('findActiveAppointmentForLead no longer returns a cancelled appointment', async () => {
      const appt = await findActiveAppointmentForLead(lead._id.toString());
      assert.equal(appt, null);
    });
  } finally {
    // Cleanup — only ever removes the throwaway docs created above.
    await WhatsAppAppointment.deleteMany({ businessId: business._id });
    await Lead.deleteOne({ _id: lead._id });
    await Business.deleteOne({ _id: business._id });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
