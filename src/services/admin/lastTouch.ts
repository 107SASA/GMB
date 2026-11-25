import SalesConversation from '@/models/SalesConversation';
import BookingConversation from '@/models/BookingConversation';
import ReportConversation from '@/models/ReportConversation';
import SupportConversation from '@/models/SupportConversation';
import LeadEvent from '@/models/LeadEvent';

/**
 * The latest thing that happened with each lead, for the Leads & Pipeline
 * table — so the team can see "what did they last say / what happened on the
 * call" without opening every profile.
 *
 * Considers the last WhatsApp message in any agent conversation (sales, demo
 * booking, report, support — matched by phone, like the lead page), the last
 * logged call and the last team note. Batched: a handful of queries per page
 * of rows, each fetching only the final message of each conversation.
 */

export type LastTouch =
  | { kind: 'message'; by: 'lead' | 'ai' | 'team'; text: string; at: string }
  | { kind: 'call'; direction: 'inbound' | 'outbound'; outcome: string; text: string; at: string; by: string | null }
  | { kind: 'note'; text: string; at: string; by: string | null };

const clip = (s: unknown, n = 140) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const ms = (d: unknown) => (d ? new Date(d as any).getTime() || 0 : 0);

export async function lastTouchForLeads(
  leads: { _id: unknown; phone?: string | null }[]
): Promise<Map<string, LastTouch>> {
  const out = new Map<string, LastTouch>();
  if (!leads.length) return out;
  const ids = leads.map((l) => l._id);
  const phones = [...new Set(leads.map((l) => l.phone).filter(Boolean))] as string[];
  const idByPhone = new Map<string, string>();
  for (const l of leads) if (l.phone) idByPhone.set(l.phone, String(l._id));

  const lastMessages = (Model: any) =>
    phones.length
      ? Model.find({ leadPhone: { $in: phones } }).select({ leadPhone: 1, messages: { $slice: -1 } }).lean()
      : Promise.resolve([]);

  const [sales, booking, report, support, events] = await Promise.all([
    lastMessages(SalesConversation),
    lastMessages(BookingConversation),
    lastMessages(ReportConversation),
    lastMessages(SupportConversation),
    LeadEvent.aggregate([
      { $match: { leadId: { $in: ids }, type: { $in: ['CALL_LOGGED', 'NOTE_ADDED'] } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$leadId', type: { $first: '$type' }, payload: { $first: '$payload' }, actor: { $first: '$actor' }, at: { $first: '$createdAt' } } },
    ]),
  ]);

  const offer = (leadId: string | undefined, touch: LastTouch) => {
    if (!leadId) return;
    const cur = out.get(leadId);
    if (!cur || ms(touch.at) > ms(cur.at)) out.set(leadId, touch);
  };

  for (const convo of [...sales, ...booking, ...report, ...support] as any[]) {
    const m = convo.messages?.[0];
    if (!m?.text || !m.at) continue;
    const by = m.role === 'lead' ? 'lead' : m.sender === 'human' ? 'team' : 'ai';
    offer(idByPhone.get(convo.leadPhone), { kind: 'message', by, text: clip(m.text), at: new Date(m.at).toISOString() });
  }

  // Team member names for calls / notes.
  const actorIds = [...new Set((events as any[]).map((e) => e.actor).filter((a) => /^[a-f0-9]{24}$/i.test(String(a))))];
  let names = new Map<string, string>();
  if (actorIds.length) {
    const { default: User } = await import('@/models/User');
    const users: any[] = await User.find({ _id: { $in: actorIds } }).select('fullName email').lean();
    names = new Map(users.map((u) => [String(u._id), u.fullName || u.email]));
  }
  for (const e of events as any[]) {
    const p = e.payload || {};
    const at = new Date(p.at || e.at).toISOString();
    const by = names.get(String(e.actor)) ?? null;
    if (e.type === 'CALL_LOGGED') {
      offer(String(e._id), {
        kind: 'call',
        direction: p.direction === 'inbound' ? 'inbound' : 'outbound',
        outcome: String(p.outcomeLabel || p.outcome || ''),
        text: clip(p.notes),
        at,
        by,
      });
    } else {
      offer(String(e._id), { kind: 'note', text: clip(p.text), at, by });
    }
  }
  return out;
}
