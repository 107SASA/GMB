import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import SalesAgentConfig from '@/models/SalesAgentConfig';
import { getSalesAgentConfig } from '@/services/sales/salesAgent';
import { SALES_TEMPLATE_VARS, DEFAULT_SALES_KNOWLEDGE } from '@/lib/salesAgentDefaults';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const config = await getSalesAgentConfig();
  return NextResponse.json({
    success: true,
    config,
    variables: SALES_TEMPLATE_VARS,
    // The editor's "Reset to defaults" for the knowledge section uses this.
    defaultKnowledge: DEFAULT_SALES_KNOWLEDGE,
  });
}

const followUpSchema = z.object({
  delayHours: z.number().min(0).max(24 * 30),
  mode: z.enum(['ai', 'template']),
  template: z.string().default(''),
  aiSystemPrompt: z.string().optional().default(''),
  onlyIfNoReply: z.boolean().default(true),
});

// A single, generous cap on any free-text knowledge field. Long enough for a
// real paragraph or two; short enough that a pasted blob can't bloat every
// grounding prompt or the config document. Applied per-field.
const KTEXT = z.string().max(4000);
const KSHORT = z.string().max(600);

const useCaseSchema = z.object({
  name: KSHORT.optional().default(''),
  problem: KTEXT.optional().default(''),
  solution: KTEXT.optional().default(''),
  benefit: KTEXT.optional().default(''),
  idealCustomer: KSHORT.optional().default(''),
  recommendedNextAction: KTEXT.optional().default(''),
});

/**
 * The knowledge block. Every field optional (an admin may fill it in over
 * time). Structured where it materially helps grounding; plain text/lists
 * otherwise. Lists are capped so a huge paste can't blow the prompt budget
 * or the document size.
 *
 * NOTE: this is DATA the LLM is told to ground replies in — it is NOT part of
 * the system guardrail (AGENT_SCOPE_GUARDRAIL lives in code and can't be
 * edited here). The grounding prompts explicitly instruct the model to treat
 * this as approved facts to convey, and still forbid inventing anything not
 * present. `useCases` accepts the legacy string form too for back-compat.
 */
const knowledgeSchema = z
  .object({
    businessOverview: KTEXT.optional().default(''),
    idealCustomerProfile: KTEXT.optional().default(''),
    targetCustomers: z.array(KSHORT).max(30).optional().default([]),
    customerProblems: z.array(KSHORT).max(30).optional().default([]),
    services: z
      .array(z.object({ name: KSHORT, description: KTEXT }))
      .max(20)
      .optional()
      .default([]),
    useCases: z
      .array(z.union([KTEXT, useCaseSchema]))
      .max(20)
      .optional()
      .default([]),
    faqs: z
      .array(z.object({ q: KSHORT, a: KTEXT }))
      .max(60)
      .optional()
      .default([]),
    educationPoints: z.array(KTEXT).max(30).optional().default([]),
    objectionResponses: z
      .object({
        PRICE: KTEXT.optional().default(''),
        DECISION_MAKER: KTEXT.optional().default(''),
        TIMING: KTEXT.optional().default(''),
        TRUST: KTEXT.optional().default(''),
        FEATURE_GAP: KTEXT.optional().default(''),
        OTHER: KTEXT.optional().default(''),
      })
      .partial()
      .optional()
      .default({}),
    pricingResponse: KTEXT.optional().default(''),
    demoExplanation: KTEXT.optional().default(''),
    subscriptionExplanation: KTEXT.optional().default(''),
    limitations: z.array(KSHORT).max(30).optional().default([]),
    escalationRules: KTEXT.optional().default(''),
  })
  // Reject unknown keys so a malformed payload can't smuggle arbitrary fields
  // into the stored config document.
  .strict();

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
  subscribeUrl: z.string().max(500).default(''),
  shopUrl: z.string().max(500).default(''),
  // Optional — a client that doesn't send it (older UI) leaves the stored
  // knowledge untouched (see the PUT handler).
  knowledge: knowledgeSchema.optional(),
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

  // Split knowledge out: only overwrite it when the client actually sent it,
  // so a save from a UI that doesn't include the knowledge editor never wipes
  // configured knowledge.
  const { knowledge, ...rest } = parsed.data;
  const existing = await SalesAgentConfig.findOne({ key: 'default' }).lean() as any;
  const priorFollowUps = Array.isArray(existing?.followUps) ? existing.followUps : [];
  // This editor owns copy and hour-level delays. Keep the nurture-page fields
  // (step id, enabled, description, first-message enabled) and mirror the
  // submitted delay into delayMinutes so a later drip does not prefer a stale minute value.
  const followUps = rest.followUps.map((step, index) => {
    const prior = priorFollowUps[index] || {};
    return {
      delayHours: step.delayHours,
      mode: step.mode,
      template: step.template,
      aiSystemPrompt: step.aiSystemPrompt,
      onlyIfNoReply: step.onlyIfNoReply,
      id: typeof prior.id === 'string' && prior.id ? prior.id : `follow-up-${index + 1}`,
      enabled: prior.enabled !== false,
      delayMinutes: Math.round(step.delayHours * 60),
      description: typeof prior.description === 'string' ? prior.description : '',
    };
  });
  const firstMessage = {
    ...rest.firstMessage,
    enabled: existing?.firstMessage?.enabled !== false,
  };
  const timingChanged = !!existing && (
    existing.firstMessage?.delayMinutes !== firstMessage.delayMinutes
    || priorFollowUps.length !== followUps.length
    || followUps.some((step, index) => {
      const prior = priorFollowUps[index];
      return !prior || prior.delayHours !== step.delayHours || prior.onlyIfNoReply !== step.onlyIfNoReply;
    })
  );
  const nextVersion = (typeof existing?.nurtureConfigVersion === 'number' ? existing.nurtureConfigVersion : 1) + (timingChanged ? 1 : 0);
  const update: Record<string, unknown> = {
    key: 'default',
    ...rest,
    firstMessage,
    followUps,
  };
  if (timingChanged) {
    update.nurtureConfigVersion = nextVersion;
    update.nurtureUpdatedBy = auth.userId;
  }
  if (knowledge !== undefined) update.knowledge = knowledge;

  await SalesAgentConfig.findOneAndUpdate(
    { key: 'default' },
    { $set: update },
    { upsert: true, setDefaultsOnInsert: true }
  );

  if (timingChanged) {
    const { default: NurtureConfigAudit } = await import('@/models/NurtureConfigAudit');
    await NurtureConfigAudit.create({
      version: nextVersion,
      previousVersion: typeof existing?.nurtureConfigVersion === 'number' ? existing.nurtureConfigVersion : 1,
      actorUserId: auth.userId,
      changes: [
        'Timing was changed from the Sales Agent editor.',
        `Config version: ${typeof existing?.nurtureConfigVersion === 'number' ? existing.nurtureConfigVersion : 1} → ${nextVersion}`,
      ],
    });
  }

  return NextResponse.json({ success: true });
}
