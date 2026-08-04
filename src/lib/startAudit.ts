import Audit from '@/models/Audit';
import { inngest } from '@/services/inngest/client';

/**
 * Creates a PENDING Audit for a business and dispatches the existing,
 * unmodified audit/generate.requested Inngest event — the same shape POST
 * /api/audit uses, extracted here since both /api/free-report/start and the
 * report-connect finalize route need to start an audit for a business that
 * has no logged-in-via-the-UI caller to go through that route.
 */
export async function createPendingAuditAndDispatch(business: any, organization: any, user: any) {
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
    metadata: { userDefinedCategory: effectiveCategory },
    // This helper is only ever called from the lead-gen entry points
    // (/free-report, WhatsApp report-connect) — never from the authenticated
    // POST /api/audit route — so it's always safe to request the fast path.
    fastMode: true,
  });

  await inngest.send({
    name: 'audit/generate.requested',
    data: { auditId: audit._id.toString() },
  });

  return audit;
}
