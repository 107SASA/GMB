import Audit from '@/models/Audit';
import { inngest } from '@/services/inngest/client';

interface StartAuditOptions {
  /**
   * fastMode skips the live geo-grid + review backfill for a seconds-not-
   * minutes result. Defaults to true because the original (and still only
   * other) callers are the lead-gen entry points (/free-report, WhatsApp
   * report-connect). The audit autopilot passes false — a paying customer's
   * automatic monthly report is a full audit.
   */
  fastMode?: boolean;
  /** Recorded on Audit.metadata.trigger for observability. */
  trigger?: string;
}

/**
 * Creates a PENDING Audit for a business and dispatches the existing,
 * unmodified audit/generate.requested Inngest event — the same shape POST
 * /api/audit uses, extracted here since /api/free-report/start, the
 * report-connect finalize route, and the audit autopilot all need to start
 * an audit for a business that has no logged-in-via-the-UI caller to go
 * through that route.
 */
export async function createPendingAuditAndDispatch(
  business: any,
  organization: any,
  user: any,
  options: StartAuditOptions = {}
) {
  const { fastMode = true, trigger } = options;
  const locationStr = [business.city, business.state].filter(Boolean).join(', ');
  const finalLocation = locationStr || business.address || 'Location hidden';
  const effectiveCategory = business.userDefinedCategory || business.category;

  const audit = await Audit.create({
    tenantId: organization._id.toString(),
    userId: user._id.toString(),
    organizationId: organization._id.toString(),

    businessId: business._id,
    businessName: business.name,
    userDefinedCategory: effectiveCategory,
    website: business.website,
    phone: business.phone,
    address: business.address,
    city: business.city,
    state: business.state,
    country: business.country,

    location: finalLocation,
    status: 'PENDING',
    metadata: { userDefinedCategory: effectiveCategory, ...(trigger ? { trigger } : {}) },
    fastMode,
  });

  await inngest.send({
    name: 'audit/generate.requested',
    data: { auditId: audit._id.toString() },
  });

  return audit;
}
