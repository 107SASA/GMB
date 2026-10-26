import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import SecurityEvent, { type SecurityOutcome, type SecuritySeverity } from '@/models/SecurityEvent';
import { getClientIp } from '@/lib/rateLimit';
import { normalizePhoneE164 } from '@/lib/phone';

/**
 * Writes the security log (models/SecurityEvent.ts). Never throws and never
 * delays the response it is attached to beyond one insert. Secrets are never
 * logged: only the email or a masked phone is kept as the "subject".
 */

export const SECURITY_EVENT_LABELS: Record<string, string> = {
  'admin.login': 'Super admin sign-in',
  'auth.login': 'Password sign-in',
  'auth.phone_otp_request': 'Login code requested',
  'auth.phone_otp_verify': 'Login code entered',
  'auth.signup_otp_verify': 'Signup code entered',
  'auth.password_reset_request': 'Password reset requested',
  'auth.password_reset_otp': 'Password reset code entered',
  'auth.password_reset': 'Password changed by reset',
  'auth.logout': 'Signed out',
  'admin.invite_create': 'Admin invite sent',
  'admin.invite_accept': 'Admin invite accepted',
  'admin.impersonate': 'Signed in as a customer',
  'admin.crm_export': 'Leads exported (CSV)',
  'admin.crm_import': 'Leads imported (CSV)',
  'webhook.signature_invalid': 'Webhook with a bad signature',
  'security.alert': 'Alert raised',
};

export function maskPhone(raw: string | null | undefined): string | undefined {
  const p = normalizePhoneE164(String(raw || '')) || String(raw || '');
  if (!p) return undefined;
  return p.length > 6 ? `${p.slice(0, 3)}${'*'.repeat(Math.max(0, p.length - 7))}${p.slice(-4)}` : '****';
}

export interface SecurityEventInput {
  type: string;
  outcome: SecurityOutcome;
  severity?: SecuritySeverity;
  userId?: unknown;
  role?: string;
  subject?: string;
  detail?: string;
  status?: number;
  metadata?: Record<string, unknown>;
}

export async function logSecurityEvent(req: Request | null, input: SecurityEventInput): Promise<void> {
  try {
    await dbConnect();
    const ip = req ? getClientIp(req) : undefined;
    let path: string | undefined;
    try { path = req ? new URL(req.url).pathname : undefined; } catch { path = undefined; }
    const severity: SecuritySeverity = input.severity
      ?? (input.outcome === 'blocked' ? 'warning' : input.outcome === 'failure' && input.type.startsWith('admin.') ? 'warning' : 'info');
    await (SecurityEvent as any).create({
      type: input.type,
      outcome: input.outcome,
      severity,
      ...(input.userId && mongoose.Types.ObjectId.isValid(String(input.userId)) ? { userId: input.userId } : {}),
      role: input.role,
      subject: input.subject ? String(input.subject).slice(0, 200) : undefined,
      ip,
      userAgent: req?.headers.get('user-agent')?.slice(0, 300) || undefined,
      path,
      status: input.status,
      detail: input.detail ? String(input.detail).slice(0, 500) : undefined,
      metadata: input.metadata,
    });
    if (input.outcome !== 'success' && (input.type === 'admin.login' || input.type === 'webhook.signature_invalid')) {
      await maybeRaiseAlert(input.type, ip);
    }
  } catch (err: any) {
    console.warn('[securityLog] could not record the event:', err?.message);
  }
}

const ALERT_WINDOW_MS = 15 * 60_000;
const ALERT_COOLDOWN_MS = 60 * 60_000;

/**
 * Pushes the super admins once an hour at most when failures pile up:
 * 10+ failed super admin sign-ins in 15 minutes (5+ from one IP), or 20+
 * webhooks with a bad signature.
 */
async function maybeRaiseAlert(type: string, ip?: string): Promise<void> {
  const since = new Date(Date.now() - ALERT_WINDOW_MS);
  const failed: Record<string, unknown> = { type, outcome: { $in: ['failure', 'blocked'] }, createdAt: { $gte: since } };
  const [total, fromIp] = await Promise.all([
    SecurityEvent.countDocuments(failed as any),
    ip ? SecurityEvent.countDocuments({ ...failed, ip } as any) : Promise.resolve(0),
  ]);
  const limitTotal = type === 'admin.login' ? 10 : 20;
  const tripped = total >= limitTotal || (type === 'admin.login' && fromIp >= 5);
  if (!tripped) return;
  const key = `${type}${type === 'admin.login' && fromIp >= 5 && total < limitTotal ? `:${ip}` : ''}`;
  if (await SecurityEvent.exists({ type: 'security.alert', 'metadata.key': key, createdAt: { $gte: new Date(Date.now() - ALERT_COOLDOWN_MS) } })) return;
  const detail = type === 'admin.login'
    ? `${total} failed super admin sign-ins in 15 minutes${fromIp >= 5 ? ` (${fromIp} from ${ip})` : ''}`
    : `${total} webhooks with a bad signature in 15 minutes`;
  await (SecurityEvent as any).create({ type: 'security.alert', outcome: 'info', severity: 'critical', ip, detail, metadata: { key, source: type } });
  try {
    const { sendPushToSuperAdmins } = await import('@/services/push');
    await sendPushToSuperAdmins({ title: 'Security alert', body: detail, data: { link: '/admin/security' } });
  } catch { /* best-effort */ }
}

/**
 * Wraps a route handler so every call is logged with its outcome — a route
 * can't forget to log. `subjectOf` reads the identifier (email / phone) from
 * a clone of the request body; the handler gets the original request.
 * Outcome: 2xx success · 429/423 blocked · 401/403/404 failure · other 4xx
 * not logged (incomplete forms) · 5xx failure.
 */
export function securityLogged<C = unknown>(
  type: string,
  handler: (req: Request, ctx: C) => Promise<Response>,
  opts: { subjectOf?: (body: any) => string | undefined; role?: string; alwaysInfo?: boolean } = {}
): (req: Request, ctx: C) => Promise<Response> {
  return async (req: Request, ctx: C) => {
    let subject: string | undefined;
    if (opts.subjectOf) {
      try {
        const body = await req.clone().json();
        subject = opts.subjectOf(body);
      } catch { subject = undefined; }
    }
    const res = await handler(req, ctx);
    const status = res.status;
    let outcome: SecurityOutcome | null =
      status < 300 ? 'success' : status === 429 || status === 423 ? 'blocked' : [401, 403, 404].includes(status) || status >= 500 ? 'failure' : null;
    if (opts.alwaysInfo && outcome === 'success') outcome = 'info';
    if (outcome) {
      let userId: unknown;
      if (subject && outcome === 'success') {
        try {
          const { default: User } = await import('@/models/User');
          const u: any = subject.includes('@')
            ? await User.findOne({ email: subject }).select('_id role').lean()
            : null;
          userId = u?._id;
        } catch { /* ignore */ }
      }
      await logSecurityEvent(req, { type, outcome, status, subject, userId, role: opts.role });
    }
    return res;
  };
}

export const emailSubject = (b: any) => (typeof b?.email === 'string' ? b.email.trim().toLowerCase() : undefined);
export const phoneSubject = (b: any) => (typeof b?.phone === 'string' ? maskPhone(b.phone) : undefined);
