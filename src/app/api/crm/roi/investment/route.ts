import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * What the owner spends per month to get leads (GrowwMatics plan, ads, staff —
 * whatever they choose to count). Used only to compute ROI %. Send
 * { monthlyAmount: null } to clear it (ROI then shows as unavailable).
 */
export async function PATCH(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    const data = await req.json().catch(() => ({}));
    let monthlyAmount: number | null = null;
    if (data.monthlyAmount !== null && data.monthlyAmount !== undefined && data.monthlyAmount !== '') {
      const n = Number(data.monthlyAmount);
      if (!Number.isFinite(n) || n < 0 || n > 1e9) {
        return NextResponse.json({ error: 'Monthly investment must be a non-negative number.' }, { status: 400 });
      }
      monthlyAmount = n;
    }
    const currency = typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency) ? data.currency : 'INR';

    await dbConnect();
    const crmInvestment = monthlyAmount && monthlyAmount > 0 ? { monthlyAmount, currency, updatedAt: new Date() } : null;
    await Business.updateOne({ _id: ctx.businessId }, { $set: { crmInvestment } });
    return NextResponse.json({ success: true, crmInvestment });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
