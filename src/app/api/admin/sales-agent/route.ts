import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import SalesAgentConfig from '@/models/SalesAgentConfig';
import { getSalesAgentConfig } from '@/services/sales/salesAgent';
import { SALES_TEMPLATE_VARS } from '@/lib/salesAgentDefaults';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const config = await getSalesAgentConfig();
  return NextResponse.json({ success: true, config, variables: SALES_TEMPLATE_VARS });
}

const followUpSchema = z.object({
  delayHours: z.number().min(0).max(24 * 30),
  mode: z.enum(['ai', 'template']),
  template: z.string().default(''),
  aiSystemPrompt: z.string().optional().default(''),
  onlyIfNoReply: z.boolean().default(true),
});

const configSchema = z.object({
  enabled: z.boolean(),
  firstMessage: z.object({
    mode: z.enum(['ai', 'template']),
    delayMinutes: z.number().min(0).max(60 * 24 * 7),
    template: z.string().default(''),
    aiSystemPrompt: z.string().default(''),
  }),
  followUps: z.array(followUpSchema).max(10),
  agentSystemPrompt: z.string().default(''),
  subscribeUrl: z.string().default(''),
  shopUrl: z.string().default(''),
});

export async function PUT(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid config', details: parsed.error.issues },
      { status: 400 }
    );
  }

  await dbConnect();
  await SalesAgentConfig.findOneAndUpdate(
    { key: 'default' },
    { $set: { key: 'default', ...parsed.data } },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return NextResponse.json({ success: true });
}
