/**
 * The removed Customer CRM Day 1 / Day 3 / Day 7 WhatsApp chain (Oct 2026).
 *
 * Any "crm/dispatch-whatsapp" event still queued from before the change ends
 * here and is dropped: no message, no FollowUp row, no activity. Pure, so a
 * test can prove it never sends.
 */
export function handleLegacyCrmDispatch(_data: { leadId?: string; templateType?: string } | null | undefined): { skipped: true; reason: string; sent: 0 } {
  return { skipped: true, reason: 'customer-crm-auto-whatsapp-removed', sent: 0 };
}
