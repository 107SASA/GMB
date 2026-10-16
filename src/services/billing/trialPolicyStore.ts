import dbConnect from '@/lib/mongodb';
import BillingPolicy from '@/models/BillingPolicy';
import {
  parseTrialPolicy,
  parseFailurePolicy,
  parseReminderPolicy,
  type TrialPolicy,
  type FailurePolicy,
  type ReminderPolicy,
} from '@/lib/billing/billingPolicy';

/**
 * The current trial offer. Any read failure → offer OFF: a database hiccup
 * must never turn into a free trial.
 */
export async function getTrialPolicy(): Promise<TrialPolicy> {
  try {
    await dbConnect();
    const doc = await BillingPolicy.findOne({ key: 'default' }).lean();
    return parseTrialPolicy(doc);
  } catch (err: any) {
    console.error('[billing] trial policy read failed — offer treated as OFF:', err?.message);
    return parseTrialPolicy(null);
  }
}

/**
 * The failed-payment policy. Any read failure → the agreed defaults
 * (trial-end failure: immediate; renewal: 3-day grace; all paid modules
 * restricted; access restored on recovery).
 */
export async function getFailurePolicy(): Promise<FailurePolicy> {
  try {
    await dbConnect();
    const doc = await BillingPolicy.findOne({ key: 'default' }).lean();
    return parseFailurePolicy(doc);
  } catch (err: any) {
    console.error('[billing] failure policy read failed — defaults used:', err?.message);
    return parseFailurePolicy(null);
  }
}

/** Reminder settings. Any read failure → defaults, which are OFF (nothing is sent). */
export async function getReminderPolicy(): Promise<ReminderPolicy> {
  try {
    await dbConnect();
    const doc = await BillingPolicy.findOne({ key: 'default' }).lean();
    return parseReminderPolicy(doc);
  } catch (err: any) {
    console.error('[billing] reminder policy read failed — reminders off:', err?.message);
    return parseReminderPolicy(null);
  }
}
