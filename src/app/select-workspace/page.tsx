import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Business from '@/models/Business';
import { BRAND_ATTRIBUTION } from '@/lib/companyInfo';
import { PAID_FIELDS, isBusinessPaid } from '@/lib/loginWorkspace';
import WorkspacePicker, { type PickerWorkspace } from './WorkspacePicker';

export const metadata: Metadata = { title: 'Choose a workspace' };

/**
 * Shown right after sign-in when the account has 2+ workspaces (proxy.ts
 * redirects /dashboard here while the chooseWorkspace cookie is set). Lists
 * the workspaces — last used first, with a Pro/Free badge — and the pick goes
 * through POST /api/business/all, which also clears that cookie.
 */
export default async function SelectWorkspacePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  await dbConnect();
  const user = (await User.findById(session.userId)
    .select('role activeBusinessId subscriptionPlan fullName')
    .lean()) as any;
  if (!user) redirect('/login');
  if (user.role === 'SUPER_ADMIN') redirect('/admin');
  if (user.role === 'TEAM_MEMBER') redirect('/studio');
  if (user.role === 'GROWTH_PARTNER') redirect('/partner');

  // Same ownership rule as the pick (POST /api/business/all), so every card
  // listed here can actually be opened.
  const businesses = (await Business.find({ userId: session.userId, isDeleted: { $ne: true } })
    .select(`_id name address city category ${PAID_FIELDS}`)
    .sort({ createdAt: 1 })
    .lean()) as any[];

  const lastUsedId = user.activeBusinessId ? String(user.activeBusinessId) : null;
  const workspaces: PickerWorkspace[] = businesses
    .map((b) => ({
      id: String(b._id),
      name: b.name || 'Unnamed business',
      subtitle: [b.category, b.city || b.address].filter(Boolean).join(' · '),
      planActive: isBusinessPaid(b, user.subscriptionPlan),
      lastUsed: String(b._id) === lastUsedId,
    }))
    // Last used first, then paid ones, then the rest (oldest first).
    .sort((a, b) => Number(b.lastUsed) - Number(a.lastUsed) || Number(b.planActive) - Number(a.planActive));

  const firstName = (user.fullName || '').trim().split(/\s+/)[0];

  return (
    <main className="min-h-dvh bg-background flex flex-col items-center px-4 py-10 sm:py-16 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-[300px] h-[300px] sm:w-[400px] sm:h-[400px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] sm:w-[400px] sm:h-[400px] bg-secondary/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-3xl relative z-10">
        <div className="text-center mb-8">
          <img src="/brand/icon.png" alt="Growwmatics AI" className="inline-block w-10 h-10 sm:w-12 sm:h-12 object-contain mb-4" />
          <h1 className="text-2xl sm:text-headline-md font-heading text-on-surface tracking-tight">
            {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
          </h1>
          <p className="text-sm text-on-surface-variant mt-2">
            Which workspace do you want to open? You can switch anytime from the dashboard.
          </p>
        </div>

        <WorkspacePicker workspaces={workspaces} />

        <p className="text-center text-xs text-outline mt-10">{BRAND_ATTRIBUTION}</p>
      </div>
    </main>
  );
}
