import { APP_ACCESS_MESSAGE } from '../../lib/whatsappCta.ts';

/**
 * The mobile app's "workspace isn't active" screen opens WhatsApp with
 * APP_ACCESS_MESSAGE. An unpaid sender gets one fixed reply (no AI): finish
 * the payment and the dashboard unlocks. A paid or trial sender is a real
 * access problem and goes to support as usual.
 */
export function isAppAccessMessage(body: string | null | undefined): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
  return !!body && norm(body) === norm(APP_ACCESS_MESSAGE);
}

export function appAccessReplyText(subscribeUrl?: string | null): string {
  const url = (subscribeUrl || '').trim();
  return [
    "Please complete your payment if it isn't done yet — as soon as it's done, your dashboard unlocks automatically in the app.",
    ...(url ? ['', `You can complete it here: ${url}`] : []),
    '',
    "Already paid? Just reply here and our team will check it for you.",
  ].join('\n');
}

/**
 * Free CRM tier (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md): the sender has a
 * free account (CRM + card scan) and tapped "Chat with us on WhatsApp" on a
 * locked tab. They never started a payment, so "complete your payment" would
 * be wrong — tell them what they have, link their free report and the plans,
 * and invite a reply for a call. Selling happens here, outside the app.
 */
export function freeCrmAccessReplyText(opts: { reportUrl?: string | null; subscribeUrl?: string | null } = {}): string {
  const report = (opts.reportUrl || '').trim();
  const plans = (opts.subscribeUrl || '').trim();
  return [
    'Your free CRM and visiting-card scan are active ✅',
    ...(report ? ['', `Your free Google profile report: ${report}`] : []),
    '',
    'To unlock posts, reviews and the Google profile tools in the app' + (plans ? `, see the plans here: ${plans}` : ', just reply here.'),
    '',
    'Or reply here and our team will call you to set it up.',
  ].join('\n');
}

/** Is this phone's account on the Free CRM tier? Plus its latest report link for the reply. */
export async function freeCrmContextForPhone(phone: string): Promise<{ free: boolean; reportUrl: string | null }> {
  const [{ default: dbConnect }, { default: User }, { default: Audit }, { normalizePhoneE164 }] = await Promise.all([
    import('@/lib/mongodb'),
    import('@/models/User'),
    import('@/models/Audit'),
    import('@/lib/phone'),
  ]);
  await dbConnect();
  const normalized = normalizePhoneE164(phone) || phone;
  const user: any = await User.findOne({ phone: normalized }).select('_id activeBusinessId businessIds').lean();
  const businessId = user?.activeBusinessId ?? user?.businessIds?.[0];
  if (!user || !businessId) return { free: false, reportUrl: null };
  const { freeCrmAllowed } = await import('@/lib/freeCrm');
  if (!(await freeCrmAllowed(String(user._id), String(businessId)))) return { free: false, reportUrl: null };
  const audit: any = await Audit.findOne({ businessId, status: 'COMPLETED' }).sort({ createdAt: -1 }).select('_id').lean();
  let reportUrl: string | null = null;
  if (audit) {
    const { reportShareLink } = await import('@/services/leads/reportLink');
    reportUrl = await reportShareLink(audit._id, String(user._id)).catch(() => null);
  }
  return { free: true, reportUrl };
}
