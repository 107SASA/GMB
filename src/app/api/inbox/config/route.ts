import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import BusinessAIConfig from '@/models/BusinessAIConfig';
import { requireBusinessContext } from '@/lib/tenant';
import mongoose from 'mongoose';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const businessIdFromQuery = url.searchParams.get('businessId') ?? undefined;

    const ctx = await requireBusinessContext({ businessIdFromBody: businessIdFromQuery });
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    let config = await BusinessAIConfig.findOne({
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    });

    if (!config) {
      config = await BusinessAIConfig.create({
        tenantId: ctx.organizationId,
        businessId: new mongoose.Types.ObjectId(ctx.businessId),
        systemPrompt:
          'You are an AI WhatsApp sales agent. Your goal is to qualify leads and help book demos. Keep responses under 60 words. Ask one question at a time. After 2 exchanges, attempt demo booking.',
        aiTone: 'Professional and helpful',
        salesRules: 'Never offer discounts. Always collect email before booking.',
        aiEnabled: true,
        aiPersonality: 'Professional',
        tone: 'Formal',
        maxResponseLength: 100,
      });
    }

    return NextResponse.json({ success: true, config });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();
    const {
      businessId: businessIdFromBody,
      systemPrompt,
      aiTone,
      salesRules,
      aiEnabled,
      aiPersonality,
      tone,
      maxResponseLength,
    } = data;

    const ctx = await requireBusinessContext({ businessIdFromBody });
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const config = await BusinessAIConfig.findOneAndUpdate(
      { businessId: new mongoose.Types.ObjectId(ctx.businessId) },
      {
        tenantId: ctx.organizationId,
        systemPrompt,
        aiTone,
        salesRules,
        aiEnabled,
        aiPersonality,
        tone,
        maxResponseLength,
      },
      { new: true, upsert: true }
    );

    return NextResponse.json({ success: true, config });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
