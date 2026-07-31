import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import ReportAgentConfig from '@/models/ReportAgentConfig';
import { getReportAgentConfig } from '@/services/report/reportAgent';
import { REPORT_INTRO_TEMPLATE_VARS, REPORT_SUMMARY_TEMPLATE_VARS } from '@/lib/reportAgentDefaults';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const config = await getReportAgentConfig();
  return NextResponse.json({
    success: true,
    config,
    introVariables: REPORT_INTRO_TEMPLATE_VARS,
    summaryVariables: REPORT_SUMMARY_TEMPLATE_VARS,
  });
}

const configSchema = z.object({
  enabled: z.boolean(),
  agentSystemPrompt: z.string().default(''),
  reportIntroTemplate: z.string().default(''),
  reportSummaryTemplate: z.string().default(''),
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
  await ReportAgentConfig.findOneAndUpdate(
    { key: 'default' },
    { $set: { key: 'default', ...parsed.data } },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return NextResponse.json({ success: true });
}
