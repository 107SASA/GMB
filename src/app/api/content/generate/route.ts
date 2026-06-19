import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateAIContent, ContentGenerationRequest } from '@/services/ai/contentEngine';

const generateContentSchema = z.object({
  businessName: z.string().min(2, 'Business name is required'),
  businessType: z.string().min(2, 'Business type is required'),
  location: z.string().min(2, 'Location is required'),
  tone: z.string().min(2, 'Tone is required'),
  keywords: z.array(z.string()).min(1, 'At least one keyword is required'),
  contentTypes: z.array(z.string()).min(1, 'At least one content type is required'),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = generateContentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    // Process synchronously since LLaMA 3.3 70B on Groq takes < 5 seconds
    const aiResult = await generateAIContent(parsed.data as ContentGenerationRequest);

    return NextResponse.json({ success: true, data: aiResult }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to generate content:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
