import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';

const TYPE_INSTRUCTIONS: Record<string, string> = {
  initial: 'a first-time review request sent right after their service',
  reminder1: 'a gentle first reminder for a customer who has not left a review yet',
  reminder2: 'a short final reminder — warm, not pushy, making clear this is the last message',
};

/**
 * Generates an editable WhatsApp message TEMPLATE for the campaign editor.
 * Placeholders ({{name}}, {{service}}, {{business}}, {{link}}) are filled per
 * customer by the Inngest worker at send time.
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    const { type = 'initial', tone = 'Friendly' } = await req.json();
    const instruction = TYPE_INSTRUCTIONS[type] || TYPE_INSTRUCTIONS.initial;

    await dbConnect();
    const business = await Business.findById(ctx.businessId).select('name category').lean() as any;
    const businessName = business?.name || 'our business';

    const { Groq } = await import('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const prompt = `Write a short WhatsApp message (2-3 sentences max) for ${businessName}${business?.category ? ` (${business.category})` : ''}. It is ${instruction}. Tone: ${tone}.

STRICT rules:
- Use EXACTLY these placeholders where personal data belongs: {{name}} for the customer's name, {{service}} for the service they received, {{business}} for the business name, {{link}} for the review link.
- The {{link}} placeholder MUST appear once.
- End with: Reply STOP to opt-out.
- Output ONLY the message text, no quotes, no explanations.`;

    const response = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.8,
      max_tokens: 200,
    });

    let message = response.choices[0]?.message?.content?.trim() || '';
    if (!message) {
      return NextResponse.json({ success: false, message: 'AI generation failed, please try again' }, { status: 502 });
    }
    if (!message.includes('{{link}}')) message += '\n{{link}}';

    return NextResponse.json({ success: true, draft: message });
  } catch (error: any) {
    console.error('Generate campaign message error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
