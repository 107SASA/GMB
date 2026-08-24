import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import mongoose from 'mongoose';
import { generateAIContent, ContentGenerationRequest } from '@/services/ai/contentEngine';
import { generateThumbnail } from '@/services/ai/imageGenerator';
import { requireBusinessContext } from '@/lib/tenant';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import { logAIUsage } from '@/lib/logAIUsage';
import { checkUsageLimit } from '@/lib/featureGating';
import { GROQ_MODEL } from '@/lib/aiModel';
import { checkRateLimit, getRateLimitConfig } from '@/lib/rateLimit';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

// Allow up to 2 minutes — sequential thumbnail generation adds time
export const maxDuration = 120;

// Burst guard (per account, short window), independent of the plan's
// aiGenerations quota — each call is a Groq content generation plus up to
// several sequential Gemini thumbnail calls. Overridable via
// CONTENT_GENERATE_RATE_LIMIT / CONTENT_GENERATE_RATE_WINDOW_MS without a
// redeploy.
const { limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS } = getRateLimitConfig('CONTENT_GENERATE', 10, 10 * 60 * 1000);

const generateContentSchema = z.object({
  businessName: z.string().min(2).optional(),
  businessType: z.string().min(2).optional(),
  location: z.string().min(2).optional(),
  tone: z.string().min(2, 'Tone is required'),
  keywords: z.array(z.string()).optional(),
  contentTypes: z.array(z.string()).min(1, 'At least one content type is required'),
  topic: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const rl = checkRateLimit(`content-generate:${ctx.userId}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many generation requests — please wait a few minutes and try again.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const body = await req.json();
    const parsed = generateContentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { business } = ctx;
    const data = parsed.data;

    // Check AI generation limit
    const limitCheck = await checkUsageLimit(ctx.userId, ctx.businessId, 'aiGenerations');
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { error: limitCheck.reason, code: limitCheck.code ?? 'UPGRADE_REQUIRED', limit: limitCheck.limit, used: limitCheck.used },
        { status: 403 }
      );
    }

    const businessLocation =
      [business.city, business.state].filter(Boolean).join(', ') ||
      business.address ||
      '';

    const request: ContentGenerationRequest = {
      businessName: data.businessName || business.name,
      businessType: data.businessType || business.category,
      location: data.location || businessLocation,
      tone: data.tone,
      keywords: data.keywords?.length ? data.keywords : (business.keywords || []),
      contentTypes: data.contentTypes,
      topic: data.topic || undefined,
    };

    if (!request.businessName || !request.businessType || !request.location) {
      return NextResponse.json(
        { error: 'Business name, type, and location are required. Complete your business profile first.' },
        { status: 400 }
      );
    }
    if (!request.keywords.length) {
      return NextResponse.json(
        { error: 'At least one keyword is required. Add keywords to your business profile or provide them here.' },
        { status: 400 }
      );
    }

    const contentStartMs = Date.now();
    const aiResult = await generateAIContent(request);

    void logAIUsage({
      userId: ctx.userId,
      businessId: ctx.businessId,
      promptType: 'content_generation',
      aiModel: GROQ_MODEL,
      promptTokens:    aiResult._usage?.promptTokens    ?? 0,
      completionTokens: aiResult._usage?.completionTokens ?? 0,
      status: 'success',
      durationMs: Date.now() - contentStartMs,
    });

    await dbConnect();
    const savedDrafts = await Post.insertMany(
      aiResult.posts.map(p => ({
        tenantId: ctx.organizationId,
        businessId: new mongoose.Types.ObjectId(ctx.businessId),
        title: p.title,
        content: p.body,
        postType: p.postType,
        hashtags: p.hashtags ?? [],
        cta: p.cta,
        thumbnailPrompt: p.thumbnailPrompt,
        status: 'draft',
        platform: 'gmb',
        aiGenerated: true,
        automationMetadata: { generatedVia: 'manual-generator', topic: data.topic || null },
      }))
    );

    // Attach draft IDs immediately
    const postsWithIds = aiResult.posts.map((p, i) => ({
      ...p,
      _id: savedDrafts[i]._id.toString(),
      imageUrl: undefined as string | undefined,
    }));

    // Thumbnails are generated AFTER the response is sent (Next.js `after`), not
    // inline. Each image is a ~10s Gemini call; doing 7 sequentially inside the
    // request blew past the gateway timeout (Nginx ~60s) and returned an HTML
    // 504 page — which the client tried to JSON.parse ("Unexpected token '<'").
    // Now the content returns immediately and images populate into the Post docs
    // in the background; the posts pages read them from the DB once ready.
    after(async () => {
      const { isStorageConfigured, rehostImageFromUrl } = await import('@/lib/storage');
      for (let i = 0; i < savedDrafts.length; i++) {
        const prompt = aiResult.posts[i].thumbnailPrompt;
        if (!prompt) continue;
        try {
          const imageUrl = await generateThumbnail(prompt);
          if (!imageUrl) continue;
          // Gemini returns a base64 data-URL, which Google Business Profile can't
          // fetch when publishing a post. Re-host to Spaces so the stored imageUrl
          // is a public URL (also keeps big data-URLs out of the DB). Falls back
          // to the original URL if storage isn't configured.
          let finalUrl = imageUrl;
          if (isStorageConfigured()) {
            try {
              finalUrl = await rehostImageFromUrl(imageUrl, `post-thumbnails/${ctx.businessId}`);
            } catch (e) {
              console.error(`[content/generate] thumbnail re-host failed for ${savedDrafts[i]._id}, using original:`, e);
            }
          }
          await Post.updateOne({ _id: savedDrafts[i]._id }, { $set: { imageUrl: finalUrl } });
        } catch (err) {
          console.error(`[content/generate] background thumbnail failed for ${savedDrafts[i]._id}:`, err);
        }
      }
    });

    return NextResponse.json(
      { success: true, data: { ...aiResult, posts: postsWithIds } },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('Failed to generate content:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
