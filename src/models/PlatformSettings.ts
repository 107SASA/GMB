import mongoose, { Schema, Document } from 'mongoose';

export interface IPlatformSettings extends Document {
  /** Read by admin/support/page.tsx for its "Open Support Inbox" mailto link. */
  supportEmail: string;
  /**
   * Admin's own sales-pipeline Kanban columns (Business.pipelineStage values)
   * — the platform-wide equivalent of a business owner's per-workspace
   * `Business.kanbanColumns`. Single shared list since this is one pipeline
   * across every prospect/customer, not per-tenant.
   */
  salesKanbanColumns: string[];
  createdAt: Date;
  updatedAt: Date;
}

// REMOVED (Sep 2026 dead-code sweep) — platformName, maxAuditsPerBusiness,
// maxPostsPerMonth, maxWhatsAppMessagesPerDay, maintenanceMode,
// defaultTrialDays, reviewRequestCooldownDays. Admin → Settings used to let a
// superadmin edit all of these, but nothing in the app ever READ them: no
// maintenance banner exists anywhere, and every usage limit is actually
// enforced via PlanConfig (see lib/planDefaults.ts, lib/featureGating.ts,
// admin/customers' plan-limits editor) — a completely separate model this
// one never fed into. Old documents may still carry these fields in the DB;
// Mongoose just ignores them now, which is harmless.
const PlatformSettingsSchema: Schema = new Schema(
  {
    supportEmail: { type: String, default: '' },
    salesKanbanColumns: {
      type: [String],
      default: ['Lead', 'Contacted', 'Demo Scheduled', 'Negotiating', 'Customer', 'Lost'],
    },
  },
  { timestamps: true }
);

export default mongoose.models.PlatformSettings ||
  mongoose.model<IPlatformSettings>('PlatformSettings', PlatformSettingsSchema);
