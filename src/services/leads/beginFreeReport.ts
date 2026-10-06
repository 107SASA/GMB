import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import Lead from '@/models/Lead';
import SalesConversation from '@/models/SalesConversation';
import { provisionShadowAccount, CLAIMED_OR_PAID_REUSE_ERROR } from '@/lib/shadowAccount';
import { createPendingAuditAndDispatch } from '@/lib/startAudit';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';
import { fileFreeReportPlatformLead, linkPlatformLeadAudit } from '@/services/leads/platformProspectEntry';
import { factsFromStored, type ProspectFacts } from '@/services/whatsapp/prospectChoice';

const REUSE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STALE_PENDING_MS = 2 * 60 * 1000;

export async function loadPlatformProspectFacts(phone: string): Promise<ProspectFacts> {
  await dbConnect();
  const normalized = normalizePhoneE164(phone) || phone;
  const key = phoneDedupeKey(phone);
  const lead = await Lead.findOne({ phone: normalized, tenantId: 'gmbboost-internal' })
    .select('name businessType auditId currentAgent humanHandoff currentStage')
    .lean() as any;
  const sales = key
    ? await SalesConversation.findOne({ phoneKey: key }).sort({ updatedAt: -1 }).select('auditId scores leadName').lean() as any
    : null;
  const auditId = lead?.auditId || sales?.auditId;
  const audit = auditId
    ? await Audit.findById(auditId).select('status businessName city location address createdAt').lean() as any
    : null;
  return factsFromStored({ lead, audit, sales });
}

export type BeginFreeReportResult =
  | { ok: true; auditId: string; status: 'COMPLETED' | 'PENDING'; businessName: string; name: string }
  | { ok: false; reason: 'claimed-account' | 'failed' };

/**
 * Starts the same free-report path as POST /api/free-report/start:
 * shadow account, platform lead, and createPendingAuditAndDispatch.
 * Reuses a completed report from the last 30 days instead of generating another.
 */
export async function beginFreeReport(input: {
  phone: string;
  name: string;
  businessName: string;
  location: string;
}): Promise<BeginFreeReportResult> {
  const businessName = input.businessName.trim();
  const location = input.location.trim();
  if (!businessName || !location) return { ok: false, reason: 'failed' };

  const comma = location.indexOf(',');
  const city = (comma >= 0 ? location.slice(0, comma) : location).trim();
  const state = comma >= 0 ? location.slice(comma + 1).trim() : undefined;

  let provisioned;
  try {
    provisioned = await provisionShadowAccount({
      phone: input.phone,
      source: 'whatsapp-report',
      businessData: {
        name: businessName,
        city,
        state,
        address: location,
      },
    });
  } catch (err: any) {
    if (err?.message === CLAIMED_OR_PAID_REUSE_ERROR) return { ok: false, reason: 'claimed-account' };
    console.warn('[beginFreeReport] provision failed:', err?.message);
    return { ok: false, reason: 'failed' };
  }

  const { user, business, organization } = provisioned;
  const leadResult = await fileFreeReportPlatformLead({
    name: input.name || user.fullName || businessName,
    phone: normalizePhoneE164(input.phone) || input.phone,
    businessName,
  }).catch((err) => {
    console.warn('[beginFreeReport] lead wiring failed:', (err as Error)?.message);
    return null;
  });

  const attach = async (auditId: unknown) => {
    if (leadResult?.leadId && auditId) {
      await linkPlatformLeadAudit(leadResult.leadId, String(auditId)).catch(() => {});
    }
  };

  const existing = await Audit.findOne({
    businessId: business._id,
    status: 'COMPLETED',
    createdAt: { $gte: new Date(Date.now() - REUSE_MAX_AGE_MS) },
  }).sort({ createdAt: -1 }).lean() as any;
  if (existing) {
    await attach(existing._id);
    return { ok: true, auditId: String(existing._id), status: 'COMPLETED', businessName, name: input.name || businessName };
  }

  const pending = await Audit.findOne({ businessId: business._id, status: 'PENDING' }).sort({ createdAt: -1 }).lean() as any;
  if (pending && Date.now() - new Date(pending.createdAt).getTime() <= STALE_PENDING_MS) {
    await attach(pending._id);
    return { ok: true, auditId: String(pending._id), status: 'PENDING', businessName, name: input.name || businessName };
  }
  if (pending) await Audit.updateOne({ _id: pending._id }, { $set: { status: 'FAILED' } });

  const audit = await createPendingAuditAndDispatch(business, organization, user, { trigger: 'whatsapp-report' });
  await attach(audit._id);
  return { ok: true, auditId: String(audit._id), status: 'PENDING', businessName, name: input.name || businessName };
}
