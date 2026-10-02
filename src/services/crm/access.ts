import mongoose from 'mongoose';

/**
 * The ONE workspace filter for reading a single customer-CRM lead by id.
 * A lead belongs to the active workspace (businessId). Only legacy rows saved
 * before leads carried a businessId fall back to the organization — a lead
 * that HAS a businessId is never reachable from another workspace of the same
 * organization by guessing its id.
 */
export function customerLeadFilter(ctx: { businessId: string; organizationId: string }, leadId: string): Record<string, unknown> | null {
  if (!mongoose.isValidObjectId(leadId)) return null;
  return {
    _id: leadId,
    $or: [
      { businessId: new mongoose.Types.ObjectId(ctx.businessId) },
      { businessId: { $exists: false }, tenantId: ctx.organizationId },
      { businessId: null, tenantId: ctx.organizationId },
    ],
  };
}
