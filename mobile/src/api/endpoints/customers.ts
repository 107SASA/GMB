import axios from 'axios';
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
  phone: z.string().nullish().catch(null),
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

const customerListSchema = z.object({
  success: z.literal(true),
  customers: z.array(customerSchema).catch([]),
  page: z.number().catch(1),
  totalPages: z.number().catch(1),
});
export type CustomerListPage = z.infer<typeof customerListSchema>;

/** GET /api/customers — same customer list the web Review Management table uses. */
export async function fetchCustomers(page = 1, search = ''): Promise<CustomerListPage> {
  const { data } = await api.get('/api/customers', { params: { page, limit: 20, search } });
  return customerListSchema.parse(data);
}

export type AddCustomerResult =
  | { created: true; customer: Customer }
  | {
      created: false;
      code: 'CUSTOMER_EXISTS';
      message: 'Customer already exists';
      customerId?: string;
      canSend: boolean;
      reason?: string;
    };

const customerExistsSchema = z.object({
  code: z.literal('CUSTOMER_EXISTS'),
  customerId: z.string().optional(),
  eligibility: z
    .object({
      allowed: z.boolean(),
      message: z.string().optional(),
    })
    .optional(),
});

/**
 * POST /api/customers. A duplicate phone returns 409 with the shared
 * eligibility result. This does not invent a second send rule.
 */
export async function addCustomer(params: { name: string; phone: string }): Promise<AddCustomerResult> {
  try {
    const { data } = await api.post('/api/customers', params);
    const parsed = z.object({ success: z.literal(true), customer: customerSchema }).parse(data);
    return { created: true, customer: parsed.customer };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 409) {
      const parsed = customerExistsSchema.safeParse(error.response.data);
      if (parsed.success) {
        const allowed = parsed.data.eligibility?.allowed === true;
        return {
          created: false,
          code: 'CUSTOMER_EXISTS',
          message: 'Customer already exists',
          customerId: parsed.data.customerId,
          canSend: allowed,
          reason: allowed ? undefined : parsed.data.eligibility?.message,
        };
      }
    }
    throw error;
  }
}

/** POST /api/campaigns/send — existing one-customer review request. */
export async function sendReviewRequest(customerId: string): Promise<void> {
  await api.post('/api/campaigns/send', { customerId });
}
