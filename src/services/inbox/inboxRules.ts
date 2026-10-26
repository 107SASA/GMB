/** Pure inbox rules. No database and no WhatsApp calls. */

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type InboxFilter =
  | 'all' | 'unread' | 'needs-reply' | 'mine' | 'unassigned' | 'human' | 'ai'
  | 'support' | 'sales' | 'nurturing' | 'demo' | 'report' | 'customers'
  | 'review-replies' | 'new' | 'resolved';

export interface InboxLeadView {
  currentAgent?: string | null;
  currentStage?: string | null;
  intent?: string | null;
  nurtureStatus?: string | null;
  humanHandoffActive?: boolean;
  assignedUserId?: string | null;
  leadScore?: number;
}

export function sessionWindowOpen(lastInboundAt: Date | string | null | undefined, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - new Date(lastInboundAt).getTime() < SESSION_WINDOW_MS;
}

export function scoreBand(score: number): 'COLD' | 'WARM' | 'HOT' | 'READY' {
  if (score >= 76) return 'READY';
  if (score >= 51) return 'HOT';
  if (score >= 26) return 'WARM';
  return 'COLD';
}

export function ownershipLabel(lead: InboxLeadView, conversationStatus?: string | null): string {
  if (conversationStatus === 'completed' || conversationStatus === 'stopped' || conversationStatus === 'resolved') return 'Resolved';
  if (lead.humanHandoffActive || lead.currentAgent === 'HUMAN' || lead.currentStage === 'HUMAN_HANDOFF') return 'Human Owned';
  if (lead.currentAgent === 'DEMO' || lead.currentStage === 'DEMO_SCHEDULED' || lead.currentStage === 'DEMO_REQUESTED') return 'Demo Scheduled';
  if (lead.currentAgent === 'IN_HOUSE' || lead.currentStage === 'CUSTOMER') return 'Customer';
  if (lead.nurtureStatus === 'ACTIVE' && (lead.currentStage === 'NURTURING' || lead.currentAgent === 'SALES')) return 'Nurturing';
  if (lead.nurtureStatus === 'OPTED_OUT' || lead.currentStage === 'DO_NOT_CONTACT') return 'Do not contact';
  return 'AI Active';
}

export function matchesInboxFilter(
  item: InboxLeadView & { unread: boolean; status?: string | null; kind?: string | null; needsReply?: boolean },
  filter: InboxFilter,
  viewerUserId?: string | null
): boolean {
  const resolved = item.status === 'resolved' || item.status === 'completed' || item.status === 'stopped';
  switch (filter) {
    case 'unread': return item.unread;
    case 'needs-reply': return !!item.needsReply;
    case 'mine': return !!viewerUserId && item.assignedUserId === viewerUserId;
    case 'unassigned': return !item.assignedUserId && (item.humanHandoffActive || item.currentAgent === 'HUMAN');
    case 'human': return item.humanHandoffActive || item.currentAgent === 'HUMAN' || item.currentStage === 'HUMAN_HANDOFF';
    case 'ai': return !item.humanHandoffActive && item.currentAgent !== 'HUMAN' && !resolved;
    case 'support': return item.kind === 'support';
    case 'sales': return item.kind === 'sales';
    case 'nurturing': return item.nurtureStatus === 'ACTIVE' && item.currentAgent === 'SALES';
    case 'demo': return item.kind === 'demo' || item.currentAgent === 'DEMO' || item.currentStage === 'DEMO_SCHEDULED' || item.intent === 'DEMO_INTEREST';
    case 'report': return item.kind === 'report';
    case 'customers': return item.kind === 'customer' || item.currentAgent === 'IN_HOUSE' || item.currentStage === 'CUSTOMER';
    case 'review-replies': return item.kind === 'review-reply';
    case 'new': return item.kind === 'new';
    case 'resolved': return resolved;
    default: return true;
  }
}

export function outboundBlockedReason(lead: { nurtureStatus?: string | null; currentStage?: string | null; currentAgent?: string | null }): string | null {
  if (lead.nurtureStatus === 'OPTED_OUT' || lead.nurtureStatus === 'STOPPED') return 'opted-out';
  if (lead.currentStage === 'DO_NOT_CONTACT') return 'do-not-contact';
  return null;
}

export function duplicateClientKey(messages: Array<{ clientKey?: string | null }>, clientKey?: string | null): boolean {
  if (!clientKey) return false;
  return messages.some((message) => message.clientKey === clientKey);
}

export function messageKind(role: string, sender?: string | null): 'customer' | 'ai' | 'human' {
  if (role === 'lead') return 'customer';
  return sender === 'human' ? 'human' : 'ai';
}
