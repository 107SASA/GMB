import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import SecurityEvent from '@/models/SecurityEvent';
import AdminActionLog from '@/models/AdminActionLog';
import User from '@/models/User';
import { SECURITY_EVENT_LABELS } from '@/services/security/securityLog';

export const dynamic = 'force-dynamic';

const PAGE = 100;
const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /api/admin/security/events?type&outcome&severity&q&days&page
 * The security log, newest first, with a 24-hour summary. `q` matches the
 * email / masked phone, the IP, or the detail text. Also returns the latest
 * admin action audit rows (AdminActionLog) for the second tab.
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const p = new URL(req.url).searchParams;
    const days = Math.min(365, Math.max(1, Number(p.get('days')) || 7));
    const filter: Record<string, unknown> = { createdAt: { $gte: new Date(Date.now() - days * 86_400_000) } };
    if (p.get('type')) filter.type = p.get('type');
    if (p.get('outcome')) filter.outcome = p.get('outcome');
    if (p.get('severity')) filter.severity = p.get('severity');
    const q = (p.get('q') || '').trim();
    if (q) {
      const rx = new RegExp(escape(q), 'i');
      filter.$or = [{ subject: rx }, { ip: rx }, { detail: rx }];
    }
    const page = Math.max(1, Number(p.get('page')) || 1);

    const since24 = new Date(Date.now() - 86_400_000);
    const [events, total, failed24, blocked24, adminFailed24, webhook24, alerts24, admin] = await Promise.all([
      SecurityEvent.find(filter as any).sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
      SecurityEvent.countDocuments(filter as any),
      SecurityEvent.countDocuments({ outcome: 'failure', createdAt: { $gte: since24 } } as any),
      SecurityEvent.countDocuments({ outcome: 'blocked', createdAt: { $gte: since24 } } as any),
      SecurityEvent.countDocuments({ type: 'admin.login', outcome: { $in: ['failure', 'blocked'] }, createdAt: { $gte: since24 } } as any),
      SecurityEvent.countDocuments({ type: 'webhook.signature_invalid', createdAt: { $gte: since24 } } as any),
      SecurityEvent.find({ type: 'security.alert', createdAt: { $gte: since24 } } as any).sort({ createdAt: -1 }).limit(5).lean(),
      AdminActionLog.find({}).sort({ createdAt: -1 }).limit(100).lean(),
    ]);
    const ids = [...new Set((events as any[]).map((e) => e.userId).filter(Boolean).map(String))];
    const users: any[] = ids.length ? await User.find({ _id: { $in: ids } }).select('fullName email').lean() : [];
    const nameOf = new Map(users.map((u) => [String(u._id), u.fullName || u.email]));

    return NextResponse.json({
      success: true,
      labels: SECURITY_EVENT_LABELS,
      summary: { failed24, blocked24, adminFailed24, webhook24, alerts: alerts24 },
      events: (events as any[]).map((e) => ({
        _id: String(e._id), at: e.createdAt, type: e.type, label: SECURITY_EVENT_LABELS[e.type] || e.type,
        outcome: e.outcome, severity: e.severity, subject: e.subject ?? null, user: e.userId ? nameOf.get(String(e.userId)) ?? null : null,
        role: e.role ?? null, ip: e.ip ?? null, userAgent: e.userAgent ?? null, path: e.path ?? null, status: e.status ?? null, detail: e.detail ?? null,
      })),
      pagination: { page, total, pages: Math.max(1, Math.ceil(total / PAGE)) },
      adminActions: (admin as any[]).map((a) => ({ _id: String(a._id), at: a.createdAt, action: a.action, admin: a.adminEmail ?? String(a.adminUserId), ip: a.ip ?? null, metadata: a.metadata ?? null })),
    });
  } catch (error: any) {
    console.error('[admin/security/events] failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
