import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';
import User from '@/models/User';

export async function getActiveBusinessContext() {
  await dbConnect();
  const authResult = await requireClient();
  
  if (!authResult.ok) {
    return { ok: false as const, error: 'Unauthorized', status: 401 };
  }

  const cookieStore = await cookies();
  const activeBusinessId = cookieStore.get('activeBusinessId')?.value;

  if (activeBusinessId) {
    const business = await Business.findById(activeBusinessId).lean();
    if (business) {
      // Validate the user has access to this business
      // Note: Assuming users own businesses via organizationId or userId
      // Check ownership or active assignments later if needed, but for now we trust the db
      return { ok: true as const, business, userId: authResult.userId };
    }
  }

  // Fallback: If no cookie, get user's activeBusinessId from DB
  const user = await User.findById(authResult.userId).lean();
  if (user && (user as any).activeBusinessId) {
    const business = await Business.findById((user as any).activeBusinessId).lean();
    if (business) {
      return { ok: true as const, business, userId: authResult.userId };
    }
  }

  // Fallback 2: Get any business they own
  const fallbackBusiness = await Business.findOne({ userId: authResult.userId }).lean();
  if (fallbackBusiness) {
    return { ok: true as const, business: fallbackBusiness, userId: authResult.userId };
  }

  // Fallback 3: If in an organization, get an org business
  if (user && (user as any).organizationId) {
     const orgBusiness = await Business.findOne({ organizationId: (user as any).organizationId }).lean();
     if (orgBusiness) {
       return { ok: true as const, business: orgBusiness, userId: authResult.userId };
     }
  }

  return { ok: false as const, error: 'No active business found', status: 404 };
}
