import { NextResponse } from 'next/server';
import { z } from 'zod';
import mongoose from 'mongoose';
import { generateAIContent, ContentGenerationRequest } from '@/services/ai/contentEngine';
import { requireBusinessContext } from '@/lib/tenant';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';

const generateContentSchema = z.object({
  businessName: z.string().min(2).optional(),
  businessType: z.string().min(2).optional(),
  location: z.string().min(2).optional(),
  tone: z.string().min(2, 'Tone is required'),
  keywords: z.array(z.string()).optional(),
  contentTypes: z.array(z.string()).min(1, 'At least one content type is required'),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const body = await req.json();
    const parsed = generateContentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { business } = ctx;
    const data = parsed.data;

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

    const aiResult = await generateAIContent(request);

    // Immediately persist the generated posts as drafts so they appear in the
    // scheduler's drafts tray even if the user navigates away before scheduling.
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
        status: 'draft',
        platform: 'gmb',
        aiGenerated: true,
        automationMetadata: { generatedVia: 'manual-generator' },
      }))
    );

    // Attach the MongoDB _id to each post so the UI can schedule without duplicating.
    const postsWithIds = aiResult.posts.map((p, i) => ({
      ...p,
      _id: savedDrafts[i]._id.toString(),
    }));

    return NextResponse.json(
      { success: true, data: { ...aiResult, posts: postsWithIds } },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('Failed to generate content:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
