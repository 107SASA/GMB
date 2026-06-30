import dbConnect from '@/lib/mongodb';
import AIUsageLog from '@/models/AIUsageLog';
import { estimateAICost } from '@/lib/aiCostEstimator';

interface LogAIUsageParams {
  userId: string;
  businessId?: string;
  promptType: string;
  aiModel?: string;
  promptTokens?: number;
  completionTokens?: number;
  tokensUsed?: number;
  status?: 'success' | 'failed' | 'partial';
  errorMessage?: string;
  durationMs?: number;
}

export async function logAIUsage(params: LogAIUsageParams): Promise<void> {
  try {
    await dbConnect();

    const model         = params.aiModel ?? 'other';
    const promptToks    = params.promptTokens    ?? 0;
    const completionToks = params.completionTokens ?? 0;
    const totalTokens   = params.tokensUsed ?? (promptToks + completionToks);
    const estimatedCost = estimateAICost(
      model,
      promptToks || Math.round(totalTokens * 0.6),
      completionToks || Math.round(totalTokens * 0.4),
    );

    await AIUsageLog.create({
      userId:           params.userId,
      businessId:       params.businessId,
      promptType:       params.promptType,
      aiModel:          model,
      tokensUsed:       totalTokens,
      promptTokens:     promptToks,
      completionTokens: completionToks,
      estimatedCost,
      status:           params.status      ?? 'success',
      errorMessage:     params.errorMessage,
      durationMs:       params.durationMs,
    });
  } catch (err) {
    // Never block the caller — logging failures are silent
    console.error('[logAIUsage] Failed to write usage log:', err);
  }
}
