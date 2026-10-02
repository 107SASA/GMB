import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { customerLeadFilter } from '@/services/crm/access';
import { logLeadActivity } from '@/services/crm/customerLeads';

/** What the owner can log by hand. System entries (stage, deal, AI score) are written by the server only. */
const OWNER_TYPES = ['call', 'WhatsApp', 'email', 'note', 'meeting'] as const;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const data = await req.json().catch(() => ({}));
    const type = String(data.type || '');
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    if (!(OWNER_TYPES as readonly string[]).includes(type)) return NextResponse.json({ error: 'Invalid activity type' }, { status: 400 });
    if (!content) return NextResponse.json({ error: 'Add a short description' }, { status: 400 });

    await dbConnect();
    const filter = customerLeadFilter(ctx, id);
    const lead: any = filter ? await Lead.findOne(filter) : null;
    if (!lead) return NextResponse.json({ error: 'Lead not found or unauthorized' }, { status: 404 });

    const activity = await logLeadActivity(lead, { type: type as any, content: content.slice(0, 2000), metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : undefined, createdBy: ctx.userId });
    lead.lastActivityAt = new Date();
    if (type !== 'note') lead.lastContactedAt = new Date();
    await lead.save();

    return NextResponse.json({ success: true, activity }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
