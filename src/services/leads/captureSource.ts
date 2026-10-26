import Lead from '@/models/Lead';
import { logLeadEvent } from '@/services/leadEvents';

/**
 * Records that a platform lead came in through `source`. The first channel
 * stays the lead's `source`; every channel is kept in `captureSources`, and a
 * repeat capture (e.g. a free-report lead who then books a demo on the
 * website) is a LEAD_CAPTURED event on the timeline. Never throws.
 */
export async function recordCaptureSource(lead: { _id: unknown; phone?: string | null }, source: string, opts: { created?: boolean; detail?: Record<string, unknown> } = {}): Promise<void> {
  try {
    await Lead.updateOne({ _id: lead._id }, { $addToSet: { captureSources: source } });
    if (!opts.created) {
      await logLeadEvent('LEAD_CAPTURED', { source, ...(opts.detail || {}) }, 'system', { leadId: lead._id as any, phone: lead.phone || undefined });
    }
  } catch (err: any) {
    console.warn('[captureSource] could not record the capture channel:', err?.message);
  }
}

/** A lead's first channel may be replaced only when it was a placeholder. */
export const PLACEHOLDER_SOURCES = new Set(['', 'Manual', 'Website']);
