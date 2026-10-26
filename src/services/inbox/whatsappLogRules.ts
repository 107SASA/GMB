/**
 * Pure rules for the full WhatsApp Inbox (services/inbox/whatsappLog.ts):
 * what a sent message reads as, which sends stay out of the Inbox, and what
 * kind of chat a thread is. No database, no WhatsApp calls.
 */

export type ThreadKind = 'support' | 'review-reply' | 'demo' | 'report' | 'sales' | 'customer' | 'new';

export const THREAD_KIND_LABEL: Record<ThreadKind, string> = {
  support: 'Support',
  'review-reply': 'Review reply',
  demo: 'Demo',
  report: 'Free report',
  sales: 'Sales',
  customer: 'Customer',
  new: 'New contact',
};

/** Template SIDs from the environment, keyed by WA_TEMPLATES name. */
export type TemplateSids = Partial<Record<string, string>>;

const TEMPLATE_LABEL: Record<string, string> = {
  salesIntro: 'Sales introduction',
  reportReady: 'Report ready',
  notification: 'Notification',
  invoiceReady: 'Invoice ready',
  welcomeCustomer: 'Welcome',
  paymentReceived: 'Payment received',
  loginOtp: 'Login code',
  reviewRequest: 'Review request',
  reviewRequestUtility: 'Review request',
};

/**
 * Sends the Inbox leaves out: review requests a customer's workspace sends to
 * its own customers (not our conversations), and login codes (security codes,
 * one per sign-in).
 */
export function excludedTemplate(contentSid: string | undefined | null, sids: TemplateSids): 'review-request' | 'login-code' | null {
  if (!contentSid) return null;
  if ((sids.reviewRequest && contentSid === sids.reviewRequest) || (sids.reviewRequestUtility && contentSid === sids.reviewRequestUtility)) return 'review-request';
  if (sids.loginOtp && contentSid === sids.loginOtp) return 'login-code';
  return null;
}

export function templateLabel(contentSid: string, sids: TemplateSids): string {
  const key = Object.keys(sids).find((name) => sids[name] && sids[name] === contentSid);
  return (key && TEMPLATE_LABEL[key]) || 'Approved template';
}

/**
 * What an outbound send-log payload (MessageQueue.payload) reads as: the text,
 * with buttons or list rows after it, or a template's filled-in values.
 */
export function outboundText(payload: Record<string, any>, sids: TemplateSids): { text: string; template?: string } {
  const body = typeof payload?.body === 'string' ? payload.body : '';
  if (payload?.contentSid && !body) {
    const template = templateLabel(String(payload.contentSid), sids);
    const vars: Record<string, string> = payload.variables && typeof payload.variables === 'object' ? payload.variables : {};
    const isNotification = sids.notification && payload.contentSid === sids.notification;
    const values = isNotification && vars['2']
      ? [String(vars['2'])]
      : Object.keys(vars).sort().map((key) => String(vars[key])).filter((value) => value && value !== '[redacted]');
    return { text: values.length ? values.join(' · ') : `[${template}]`, template };
  }
  const choices = Array.isArray(payload?.buttons)
    ? payload.buttons.map((button: any) => button?.title).filter(Boolean)
    : Array.isArray(payload?.list)
      ? payload.list.map((row: any) => row?.item).filter(Boolean)
      : [];
  const media = payload?.mediaUrl ? '📎 Image' : '';
  const text = [body, choices.length ? `[${choices.join(' | ')}]` : '', !body && media ? media : ''].filter(Boolean).join('\n');
  return { text: text || '[message]', ...(payload?.sentAsTemplate ? { template: String(payload.sentAsTemplate) } : {}) };
}

/** What an inbound message reads as when it has no text (an image, a voice note…). */
export function inboundText(body: string | null | undefined, mediaCount = 0): string {
  const text = (body || '').trim();
  if (text) return text;
  return mediaCount > 0 ? `📎 Attachment (${mediaCount}) — open WhatsApp to view` : '[empty message]';
}

/** The one label a thread is shown with — the most urgent kind first. */
export function threadKind(facts: {
  supportOpen?: boolean;
  reviewReply?: boolean;
  demoOpen?: boolean;
  reportOpen?: boolean;
  salesThread?: boolean;
  customer?: boolean;
}): ThreadKind {
  if (facts.supportOpen) return 'support';
  if (facts.demoOpen) return 'demo';
  if (facts.reportOpen) return 'report';
  if (facts.customer) return 'customer';
  if (facts.salesThread) return 'sales';
  if (facts.reviewReply) return 'review-reply';
  return 'new';
}

/**
 * Someone should look: the person wrote last, or it is a support request
 * (its automatic acknowledgement is not an answer). Until the team resolves it.
 */
export function needsReply(thread: { lastDirection?: string | null; status?: string | null }, kind?: ThreadKind): boolean {
  if (thread.status === 'resolved') return false;
  return thread.lastDirection === 'in' || kind === 'support';
}

export function threadUnread(thread: { lastInboundAt?: Date | string | null; lastReadAt?: Date | string | null }): boolean {
  if (!thread.lastInboundAt) return false;
  if (!thread.lastReadAt) return true;
  return new Date(thread.lastInboundAt).getTime() > new Date(thread.lastReadAt).getTime();
}
