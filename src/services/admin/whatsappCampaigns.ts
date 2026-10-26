import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import WhatsAppTemplate from '@/models/WhatsAppTemplate';
import WhatsAppCampaign from '@/models/WhatsAppCampaign';
import WhatsAppCampaignRecipient from '@/models/WhatsAppCampaignRecipient';
import { lookupContentTemplate, CONTENT_SID_RE } from '@/services/twilio/contentTemplates';
import {
  CAMPAIGN_MAX_RECIPIENTS,
  SKIP_LABEL,
  campaignMessageLine,
  campaignSkipReason,
  campaignVariables,
  renderTemplate,
  templatePlaceholders,
  templateShapeError,
  type CampaignSkipReason,
} from '@/lib/whatsappCampaign';

/**
 * Super Admin WhatsApp sends to leads: the approved templates the team may
 * use (added here, not in the server environment) and "Send WhatsApp" from
 * Leads & Pipeline — a preview of who gets it and who is left out (and why),
 * then a background send in batches, one row per lead.
 */

const PLATFORM = 'gmbboost-internal';
type Result<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; status: number; error: string };

function publicTemplate(t: any) {
  const shapeError = templateShapeError(t.placeholders || []);
  return {
    id: String(t._id),
    contentSid: t.contentSid,
    label: t.label,
    twilioName: t.twilioName || null,
    category: t.category || null,
    body: t.body || '',
    placeholders: t.placeholders || [],
    approvalStatus: t.approvalStatus,
    rejectionReason: t.rejectionReason || null,
    checkedAt: t.checkedAt || null,
    active: t.active !== false,
    usable: sendable(t) === null,
    notUsableReason: sendable(t),
    shapeError,
  };
}

/** Why a template cannot be sent to leads right now, or null. */
function sendable(t: any): string | null {
  if (!t) return 'Template not found.';
  if (t.active === false) return 'This template is switched off.';
  if (t.approvalStatus !== 'approved') return `WhatsApp approval is "${t.approvalStatus}" — only approved templates can be sent.`;
  if (t.category === 'AUTHENTICATION') return 'Login-code (authentication) templates cannot be sent to leads.';
  return templateShapeError(t.placeholders || []);
}

export async function listTemplates() {
  await dbConnect();
  const rows = await WhatsAppTemplate.find({}).sort({ createdAt: -1 }).lean();
  return rows.map(publicTemplate);
}

/** Adds a template by its SID. Its name, text, category and approval come from Twilio. */
export async function addTemplate(input: { contentSid?: unknown; label?: unknown }, actorId: string): Promise<Result<{ template: ReturnType<typeof publicTemplate> }>> {
  await dbConnect();
  const contentSid = String(input.contentSid || '').trim();
  if (!CONTENT_SID_RE.test(contentSid)) return { ok: false, status: 400, error: 'A template SID is "HX" followed by 32 letters and numbers.' };
  if (await WhatsAppTemplate.exists({ contentSid })) return { ok: false, status: 409, error: 'This template is already added.' };
  const found = await lookupContentTemplate(contentSid);
  if (!found.ok) return found;
  const placeholders = templatePlaceholders(found.body);
  const label = String(input.label || '').trim().slice(0, 60) || found.twilioName || contentSid;
  const t = await WhatsAppTemplate.create({
    contentSid,
    label,
    twilioName: found.twilioName,
    category: found.category,
    body: found.body,
    placeholders,
    approvalStatus: found.approvalStatus,
    rejectionReason: found.rejectionReason,
    checkedAt: new Date(),
    createdBy: mongoose.isValidObjectId(actorId) ? actorId : undefined,
  });
  return { ok: true, template: publicTemplate(t) };
}

/** Re-reads the template from Twilio (approval can change: approved, paused, rejected). */
export async function refreshTemplate(id: string): Promise<Result<{ template: ReturnType<typeof publicTemplate> }>> {
  await dbConnect();
  if (!mongoose.isValidObjectId(id)) return { ok: false, status: 404, error: 'Template not found.' };
  const t: any = await WhatsAppTemplate.findById(id);
  if (!t) return { ok: false, status: 404, error: 'Template not found.' };
  const found = await lookupContentTemplate(t.contentSid);
  if (!found.ok) return found;
  Object.assign(t, {
    twilioName: found.twilioName,
    category: found.category,
    body: found.body,
    placeholders: templatePlaceholders(found.body),
    approvalStatus: found.approvalStatus,
    rejectionReason: found.rejectionReason,
    checkedAt: new Date(),
  });
  await t.save();
  return { ok: true, template: publicTemplate(t) };
}

export async function updateTemplate(id: string, patch: { label?: unknown; active?: unknown }): Promise<Result<{ template: ReturnType<typeof publicTemplate> }>> {
  await dbConnect();
  if (!mongoose.isValidObjectId(id)) return { ok: false, status: 404, error: 'Template not found.' };
  const set: Record<string, unknown> = {};
  if (typeof patch.label === 'string' && patch.label.trim()) set.label = patch.label.trim().slice(0, 60);
  if (typeof patch.active === 'boolean') set.active = patch.active;
  const t = await WhatsAppTemplate.findByIdAndUpdate(id, { $set: set }, { new: true });
  if (!t) return { ok: false, status: 404, error: 'Template not found.' };
  return { ok: true, template: publicTemplate(t) };
}

/** Removes it from the list. Past sends keep their record. */
export async function removeTemplate(id: string): Promise<Result> {
  await dbConnect();
  if (!mongoose.isValidObjectId(id)) return { ok: false, status: 404, error: 'Template not found.' };
  const res = await WhatsAppTemplate.deleteOne({ _id: id });
  if (!res.deletedCount) return { ok: false, status: 404, error: 'Template not found.' };
  return { ok: true };
}

// ── Recipients ──────────────────────────────────────────────────────────────

export interface Audience {
  /** Selected lead ids. */
  ids?: unknown;
  /** Or: every lead matching the Leads & Pipeline filters (the page's query string). */
  filters?: unknown;
}

async function audienceLeads(audience: Audience): Promise<Result<{ leads: any[] }>> {
  const select = 'name phone nurtureStatus currentStage currentAgent';
  if (Array.isArray(audience.ids)) {
    const ids = [...new Set(audience.ids.map(String))].filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return { ok: false, status: 400, error: 'Select at least one lead.' };
    if (ids.length > CAMPAIGN_MAX_RECIPIENTS) return { ok: false, status: 400, error: `One send can go to at most ${CAMPAIGN_MAX_RECIPIENTS} leads.` };
    const leads = await Lead.find({ _id: { $in: ids }, tenantId: PLATFORM }).select(select).lean();
    return { ok: true, leads };
  }
  if (typeof audience.filters === 'string') {
    const params = new URLSearchParams(audience.filters);
    ['page', 'pageSize', 'view'].forEach((key) => params.delete(key));
    const { queryPipeline } = await import('@/services/admin/pipelineQuery');
    const { rows } = await queryPipeline(params);
    if (!rows.length) return { ok: false, status: 400, error: 'No leads match these filters.' };
    if (rows.length > CAMPAIGN_MAX_RECIPIENTS) {
      return { ok: false, status: 400, error: `${rows.length} leads match — one send can go to at most ${CAMPAIGN_MAX_RECIPIENTS}. Narrow the filters.` };
    }
    return { ok: true, leads: rows.map((row: any) => row.lead) };
  }
  return { ok: false, status: 400, error: 'Select leads, or send to the filtered list.' };
}

/** When each lead last got a campaign message. */
async function lastCampaignAt(leadIds: unknown[]): Promise<Map<string, Date>> {
  if (!leadIds.length) return new Map();
  const rows = await WhatsAppCampaignRecipient.aggregate([
    { $match: { leadId: { $in: leadIds }, status: 'sent' } },
    { $group: { _id: '$leadId', at: { $max: '$sentAt' } } },
  ]);
  return new Map(rows.map((row: any) => [String(row._id), row.at]));
}

async function splitAudience(leads: any[], skipRecent: boolean) {
  const last = await lastCampaignAt(leads.map((lead) => lead._id));
  const eligible: any[] = [];
  const skipped: { lead: any; reason: CampaignSkipReason }[] = [];
  const phones = new Set<string>();
  const { normalizePhoneE164 } = await import('@/lib/phone');
  for (const lead of leads) {
    let reason = campaignSkipReason(lead, { lastCampaignAt: last.get(String(lead._id)), skipRecent });
    // Two leads on one number get one message.
    const phone = normalizePhoneE164(lead.phone || '');
    if (!reason && phone && phones.has(phone)) reason = 'already-in-campaign';
    if (reason) skipped.push({ lead, reason });
    else { eligible.push(lead); if (phone) phones.add(phone); }
  }
  return { eligible, skipped };
}

async function loadSendable(templateId: unknown): Promise<Result<{ template: any }>> {
  if (!mongoose.isValidObjectId(String(templateId || ''))) return { ok: false, status: 400, error: 'Choose a template.' };
  const template: any = await WhatsAppTemplate.findById(templateId).lean();
  const why = sendable(template);
  if (why) return { ok: false, status: template ? 409 : 404, error: why };
  return { ok: true, template };
}

export async function previewSend(input: Audience & { templateId?: unknown; message?: unknown; skipRecent?: unknown }) {
  await dbConnect();
  const loaded = await loadSendable(input.templateId);
  if (!loaded.ok) return loaded;
  const { template } = loaded;
  const needsMessage = template.placeholders.includes(2);
  const line = needsMessage ? campaignMessageLine(String(input.message || '')) : { ok: true as const, line: '' };
  const audience = await audienceLeads(input);
  if (!audience.ok) return audience;
  const { eligible, skipped } = await splitAudience(audience.leads, input.skipRecent !== false);
  const counts: Record<string, number> = {};
  for (const row of skipped) counts[row.reason] = (counts[row.reason] || 0) + 1;
  const sample = eligible[0];
  return {
    ok: true as const,
    total: audience.leads.length,
    eligible: eligible.length,
    messageError: line.ok ? null : line.error,
    preview: sample && line.ok
      ? { name: sample.name || sample.phone, text: renderTemplate(template.body, campaignVariables(template.placeholders, sample.name, line.line)) }
      : null,
    skipped: Object.entries(counts).map(([reason, count]) => ({ reason, label: SKIP_LABEL[reason as CampaignSkipReason], count })),
    skippedLeads: skipped.slice(0, 200).map(({ lead, reason }) => ({ id: String(lead._id), name: lead.name || '', phone: lead.phone || '', label: SKIP_LABEL[reason] })),
  };
}

/** Creates the send and hands it to the background sender. */
export async function createSend(
  input: Audience & { templateId?: unknown; message?: unknown; name?: unknown; skipRecent?: unknown },
  actorId: string
): Promise<Result<{ campaignId: string; queued: number; skipped: number }>> {
  await dbConnect();
  const loaded = await loadSendable(input.templateId);
  if (!loaded.ok) return loaded;
  const { template } = loaded;
  let line = '';
  if (template.placeholders.includes(2)) {
    const checked = campaignMessageLine(String(input.message || ''));
    if (!checked.ok) return { ok: false, status: 400, error: checked.error };
    line = checked.line;
  }
  const audience = await audienceLeads(input);
  if (!audience.ok) return audience;
  const { eligible, skipped } = await splitAudience(audience.leads, input.skipRecent !== false);
  if (!eligible.length) return { ok: false, status: 400, error: 'None of these leads can be messaged (see the reasons in the preview).' };

  const name = String(input.name || '').trim().slice(0, 80)
    || `${template.label} · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}`;
  const campaign: any = await WhatsAppCampaign.create({
    name,
    templateId: template._id,
    contentSid: template.contentSid,
    templateLabel: template.label,
    message: line,
    counts: { total: eligible.length + skipped.length, sent: 0, failed: 0, skipped: skipped.length },
    createdBy: mongoose.isValidObjectId(actorId) ? actorId : undefined,
  });
  await WhatsAppCampaignRecipient.insertMany([
    ...eligible.map((lead) => ({ campaignId: campaign._id, leadId: lead._id, phone: lead.phone, name: lead.name || '', status: 'queued' })),
    ...skipped.map(({ lead, reason }) => ({ campaignId: campaign._id, leadId: lead._id, phone: lead.phone || '', name: lead.name || '', status: 'skipped', reason: SKIP_LABEL[reason] })),
  ], { ordered: false });
  const { inngest } = await import('@/services/inngest/client');
  await inngest.send({ name: 'whatsapp/campaign.send', data: { campaignId: String(campaign._id) } });
  return { ok: true, campaignId: String(campaign._id), queued: eligible.length, skipped: skipped.length };
}

// ── Background sending ──────────────────────────────────────────────────────

export const CAMPAIGN_BATCH_SIZE = 25;

/**
 * Sends up to one batch. Each row is claimed (queued → sending) before the
 * WhatsApp call and the lead is checked again — someone may have opted out
 * since the send was created. Returns how many are still queued.
 */
export async function sendCampaignBatch(campaignId: string, batchSize = CAMPAIGN_BATCH_SIZE): Promise<{ remaining: number }> {
  await dbConnect();
  const campaign: any = await WhatsAppCampaign.findById(campaignId).lean();
  if (!campaign) return { remaining: 0 };
  const template: any = await WhatsAppTemplate.findById(campaign.templateId).lean();
  const placeholders: number[] = template?.placeholders || [];
  const { sendTemplateMessage } = await import('@/services/twilio/client');
  const { withWhatsAppSendContext } = await import('@/services/inbox/whatsappLog');
  const { logLeadEvent } = await import('@/services/leadEvents');

  const rows: any[] = await WhatsAppCampaignRecipient.find({ campaignId, status: 'queued' }).sort({ _id: 1 }).limit(batchSize).lean();
  for (const row of rows) {
    const claimed = await WhatsAppCampaignRecipient.updateOne({ _id: row._id, status: 'queued' }, { $set: { status: 'sending' } });
    if (!claimed.modifiedCount) continue;
    const finish = async (status: 'sent' | 'failed' | 'skipped', extra: Record<string, unknown> = {}) => {
      await WhatsAppCampaignRecipient.updateOne({ _id: row._id }, { $set: { status, ...extra } });
      await WhatsAppCampaign.updateOne({ _id: campaignId }, { $inc: { [`counts.${status}`]: 1 } });
    };
    // The template could have been paused or switched off since the send began.
    const why = sendable(template);
    if (why) { await finish('failed', { reason: why }); continue; }
    const lead: any = await Lead.findById(row.leadId).select('name phone nurtureStatus currentStage currentAgent').lean();
    const skip = lead ? campaignSkipReason(lead, { skipRecent: false }) : 'no-phone';
    if (skip) { await finish('skipped', { reason: SKIP_LABEL[skip] }); continue; }

    const variables = campaignVariables(placeholders, lead.name, campaign.message);
    // Recorded in the WhatsApp Inbox as the team's message.
    const res = await withWhatsAppSendContext(
      { sender: 'team', userId: campaign.createdBy ? String(campaign.createdBy) : undefined },
      () => sendTemplateMessage(lead.phone, campaign.contentSid, variables)
    ).catch((err: any) => ({ success: false as const, error: err?.message || 'send failed', sid: undefined }));
    if (res.success) {
      await finish('sent', { sid: res.sid, sentAt: new Date() });
      logLeadEvent(
        'MESSAGE_SENT',
        { channel: 'whatsapp', source: 'WHATSAPP_CAMPAIGN', campaignId: String(campaignId), campaign: campaign.name, template: campaign.templateLabel, sid: res.sid },
        campaign.createdBy ? String(campaign.createdBy) : 'super-admin',
        { leadId: lead._id, phone: lead.phone }
      );
    } else {
      await finish('failed', { reason: String(res.error || 'WhatsApp did not accept the message').slice(0, 300) });
    }
  }
  const remaining = await WhatsAppCampaignRecipient.countDocuments({ campaignId, status: 'queued' });
  if (!remaining) await finishCampaign(campaignId);
  return { remaining };
}

/** Closes the send. A row left 'sending' (the server stopped mid-send) is not re-sent: it may have gone out. */
async function finishCampaign(campaignId: string): Promise<void> {
  const interrupted = await WhatsAppCampaignRecipient.updateMany(
    { campaignId, status: 'sending' },
    { $set: { status: 'failed', reason: 'Interrupted while sending — not re-sent, it may have been delivered. Check the WhatsApp Inbox.' } }
  );
  await WhatsAppCampaign.updateOne(
    { _id: campaignId, status: 'sending' },
    { $set: { status: 'done', finishedAt: new Date() }, ...(interrupted.modifiedCount ? { $inc: { 'counts.failed': interrupted.modifiedCount } } : {}) }
  );
}

export async function listCampaigns(limit = 20) {
  await dbConnect();
  const rows = await WhatsAppCampaign.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((c: any) => ({
    id: String(c._id), name: c.name, templateLabel: c.templateLabel, message: c.message,
    status: c.status, counts: c.counts, createdAt: c.createdAt, finishedAt: c.finishedAt || null,
  }));
}

export async function getCampaign(id: string) {
  await dbConnect();
  if (!mongoose.isValidObjectId(id)) return null;
  const c: any = await WhatsAppCampaign.findById(id).lean();
  if (!c) return null;
  const recipients = await WhatsAppCampaignRecipient.find({ campaignId: id }).sort({ status: 1, _id: 1 }).limit(CAMPAIGN_MAX_RECIPIENTS).lean();
  return {
    id: String(c._id), name: c.name, templateLabel: c.templateLabel, message: c.message,
    status: c.status, counts: c.counts, createdAt: c.createdAt, finishedAt: c.finishedAt || null,
    recipients: (recipients as any[]).map((r) => ({ leadId: String(r.leadId), name: r.name, phone: r.phone, status: r.status, reason: r.reason || null, sentAt: r.sentAt || null })),
  };
}
