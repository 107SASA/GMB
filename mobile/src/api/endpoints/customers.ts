import { z } from 'zod';
import { api } from '../client';

/**
 * Review-request customers (src/models/Customer.ts on the backend) — the
 * audience for WhatsApp review campaigns. Distinct from CRM Leads
 * (endpoints/leads.ts): a Customer here is someone who already did business
 * with the owner and gets asked for a Google review, not a sales prospect.
 */
const customerSchema = z.object({
  _id: z.string(),
  name: z.string().catch(''),
  phone: z.string().nullable().catch(null),
  reviewStatus: z.enum(['Pending', 'Requested', 'Completed', 'Failed']).catch('Pending'),
  optedOut: z.boolean().catch(false),
});
export type Customer = z.infer<typeof customerSchema>;

const quickAddResponseSchema = z.object({
  success: z.literal(true),
  existing: z.boolean(),
  customer: customerSchema,
  reviewRequestSent: z.boolean(),
  reason: z.string().optional(),
});
export type QuickAddCustomerResult = z.infer<typeof quickAddResponseSchema>;

/**
 * POST /api/customers/quick-add — create (or reuse) a Customer from a phone
 * number and immediately send them a WhatsApp review request. This is what
 * the dashboard "Add Customer" card calls; the mobile "Add lead" screen
 * under All Contacts is unrelated (CRM pipeline, endpoints/leads.ts).
 */
export async function quickAddCustomer(params: { phone: string; name?: string }): Promise<QuickAddCustomerResult> {
  const { data } = await api.post('/api/customers/quick-add', params);
  return quickAddResponseSchema.parse(data);
}
