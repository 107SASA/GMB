/**
 * "Needs a call" reasons for a FREE account (CRM + card scan) — pure, tested.
 * Shown on the prospect's lead in Admin → Leads, so sales calls the free
 * users most likely to buy the Google profile plan.
 * docs/FREE_ACCOUNT_REGISTRATION_PLAN.md §7
 */

export interface FreeAccountFacts {
  reportScore: number | null;
  scansThisMonth: number;
  maxScansPerMonth: number; // -1 = unlimited
  activeLeads: number;
  maxActiveLeads: number; // -1 = unlimited
  /** Distinct days with CRM activity (leads added / cards scanned) in the last 7 days. */
  activeDaysLast7: number;
  unlockRequestedAt: Date | null;
  now: Date;
}

export const CALL_RULES = {
  lowScoreBelow: 60,
  scansShare: 0.8, // 40 of 50
  leadsShare: 0.9, // 180 of 200
  activeDays: 3,
  unlockRecentDays: 14,
} as const;

const DAY = 24 * 60 * 60 * 1000;

export function freeAccountCallReasons(f: FreeAccountFacts): string[] {
  const reasons: string[] = [];
  if (f.unlockRequestedAt && f.now.getTime() - new Date(f.unlockRequestedAt).getTime() <= CALL_RULES.unlockRecentDays * DAY) {
    reasons.push('Asked to unlock on WhatsApp');
  }
  if (typeof f.reportScore === 'number' && f.reportScore < CALL_RULES.lowScoreBelow) {
    reasons.push(`Low Google profile score (${f.reportScore}/100)`);
  }
  if (f.maxScansPerMonth > 0 && f.scansThisMonth >= Math.ceil(f.maxScansPerMonth * CALL_RULES.scansShare)) {
    reasons.push(`Scanned ${f.scansThisMonth} of ${f.maxScansPerMonth} cards this month`);
  }
  if (f.maxActiveLeads > 0 && f.activeLeads >= Math.ceil(f.maxActiveLeads * CALL_RULES.leadsShare)) {
    reasons.push(`${f.activeLeads} of ${f.maxActiveLeads} active leads`);
  }
  if (f.activeDaysLast7 >= CALL_RULES.activeDays) {
    reasons.push(`Using the CRM regularly (${f.activeDaysLast7} days this week)`);
  }
  return reasons;
}

// ── Daily sync (freeAccountSignalsCron) ──────────────────────────────────

const PROSPECT_SOURCES = ['App Sign-up', 'Website Sign-up', 'Website Free Report', 'WhatsApp Free Report'];

/**
 * Refreshes lead.freeAccount (usage + call reasons) on every super-admin CRM
 * prospect whose account is on the Free CRM tier; clears it once they pay
 * (or the account is gone). Read-only on the customer side.
 */
export async function syncFreeAccountSignals(now: Date = new Date(), limit = 5000): Promise<{ checked: number; updated: number; cleared: number }> {
  const [{ default: dbConnect }, { default: mongoose }, { default: Lead }, { default: User }, { default: Audit }, { default: AIUsageLog }, freeCrm, { normalizePhoneE164 }] =
    await Promise.all([
      import('@/lib/mongodb'),
      import('mongoose'),
      import('@/models/Lead'),
      import('@/models/User'),
      import('@/models/Audit'),
      import('@/models/AIUsageLog'),
      import('@/lib/freeCrm'),
      import('@/lib/phone'),
    ]);
  await dbConnect();
  const prospects: any[] = await Lead.find({
    tenantId: 'gmbboost-internal',
    $or: [{ source: { $in: PROSPECT_SOURCES } }, { captureSources: { $in: PROSPECT_SOURCES } }],
  })
    .select('_id phone freeAccount')
    .sort({ _id: -1 })
    .limit(limit)
    .lean();

  let updated = 0;
  let cleared = 0;
  const since7 = new Date(now.getTime() - 7 * DAY);
  for (const p of prospects) {
    try {
      const phone = normalizePhoneE164(String(p.phone || '')) || p.phone;
      const user: any = phone ? await User.findOne({ phone }).select('_id activeBusinessId businessIds lastSeenAt lastLoginAt').lean() : null;
      const businessId = user ? String(user.activeBusinessId ?? user.businessIds?.[0] ?? '') : '';
      const free = user && businessId ? await freeCrm.freeCrmAllowed(String(user._id), businessId) : false;
      if (!free) {
        if (p.freeAccount) {
          await Lead.updateOne({ _id: p._id }, { $unset: { freeAccount: 1 } });
          cleared++;
        }
        continue;
      }
      const bid = new mongoose.Types.ObjectId(businessId);
      const [usage, audit, leadDays, scanDays] = await Promise.all([
        freeCrm.freeCrmUsage(String(user._id), businessId),
        Audit.findOne({ businessId: bid, status: 'COMPLETED' }).sort({ createdAt: -1 }).select('overallScore').lean() as Promise<any>,
        Lead.aggregate([
          { $match: { businessId: bid, createdAt: { $gte: since7 } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } } },
        ]),
        AIUsageLog.aggregate([
          { $match: { businessId: bid, promptType: 'business_card_scan', createdAt: { $gte: since7 } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } } },
        ]),
      ]);
      const activeDaysLast7 = new Set([...leadDays, ...scanDays].map((d: any) => d._id)).size;
      const unlockRequestedAt = p.freeAccount?.unlockRequestedAt ?? null;
      const facts: FreeAccountFacts = {
        reportScore: typeof audit?.overallScore === 'number' ? audit.overallScore : null,
        scansThisMonth: usage.scansUsed,
        maxScansPerMonth: usage.maxScansPerMonth,
        activeLeads: usage.activeLeads,
        maxActiveLeads: usage.maxActiveLeads,
        activeDaysLast7,
        unlockRequestedAt,
        now,
      };
      await Lead.updateOne(
        { _id: p._id },
        {
          $set: {
            freeAccount: {
              businessId: bid,
              activeLeads: facts.activeLeads,
              maxActiveLeads: facts.maxActiveLeads,
              scansThisMonth: facts.scansThisMonth,
              maxScansPerMonth: facts.maxScansPerMonth,
              reportScore: facts.reportScore,
              lastActiveAt: user.lastSeenAt ?? user.lastLoginAt ?? null,
              unlockRequestedAt,
              callReasons: freeAccountCallReasons(facts),
              updatedAt: now,
            },
          },
        }
      );
      updated++;
    } catch (err) {
      console.warn('[free-account-signals] lead skipped:', String(p._id), (err as Error)?.message);
    }
  }
  return { checked: prospects.length, updated, cleared };
}

// ── Every free account is a sales lead ───────────────────────────────────

/**
 * Files a super-admin CRM prospect ("App Sign-up" / "Website Sign-up") for
 * real, verified free accounts that have none yet — e.g. a website sign-up
 * that never paid, or an account that existed before free accounts did.
 * Old shadow accounts are skipped (their free report already filed one).
 */
export async function ensureFreeAccountLeads(now: Date = new Date(), limit = 500): Promise<{ checked: number; filed: number }> {
  const [{ default: dbConnect }, { default: User }, { default: Business }, { default: Lead }, freeCrm, { fileSignupPlatformLead }] = await Promise.all([
    import('@/lib/mongodb'),
    import('@/models/User'),
    import('@/models/Business'),
    import('@/models/Lead'),
    import('@/lib/freeCrm'),
    import('@/services/leads/platformProspectEntry'),
  ]);
  await dbConnect();
  const since = new Date(now.getTime() - 365 * DAY);
  const users: any[] = await User.find({
    role: 'CLIENT',
    isShadowAccount: { $ne: true },
    isDeleted: { $ne: true },
    phone: { $type: 'string', $regex: /^\+/ },
    createdAt: { $gte: since },
  })
    .select('_id fullName phone activeBusinessId businessIds')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  let filed = 0;
  for (const u of users) {
    try {
      if (await Lead.exists({ tenantId: 'gmbboost-internal', phone: u.phone })) continue;
      const businessId = String(u.activeBusinessId ?? u.businessIds?.[0] ?? '');
      if (!businessId || !(await freeCrm.freeCrmAllowed(String(u._id), businessId))) continue;
      const biz: any = await Business.findById(businessId).select('name provisionedVia').lean();
      await fileSignupPlatformLead({
        name: u.fullName || biz?.name || u.phone,
        phone: u.phone,
        businessName: biz?.name || 'Business',
        channel: biz?.provisionedVia === 'app-signup' ? 'app' : 'website',
      });
      filed++;
    } catch (err) {
      console.warn('[free-account-leads] skipped', String(u._id), (err as Error)?.message);
    }
  }
  return { checked: users.length, filed };
}

// ── "Get your free report" nudges ────────────────────────────────────────

/** Pure: which nudge (1 or 2) is due for a free account with no report, if any. Day 1 and day 3. */
export function freeReportNudgeDue(ageDays: number, sent: number): 1 | 2 | null {
  if (sent === 0 && ageDays >= 1) return 1;
  if (sent === 1 && ageDays >= 3) return 2;
  return null;
}

/**
 * Free accounts that skipped picking their Google listing get no report, so
 * the WhatsApp sales nurture (which starts when a report completes) never
 * begins. Two push notifications (day 1, day 3) bring them to the in-app
 * "Get your free report" card; once they pick a listing, the report — and
 * with it the normal nurture — starts. Push only: a WhatsApp message here
 * would need a Meta-approved template (outside the 24-hour window).
 */
export async function nudgeFreeReport(now: Date = new Date(), limit = 500): Promise<{ checked: number; sent: number }> {
  const [{ default: dbConnect }, { default: Business }, { default: Audit }, freeCrm, { FREE_SIGNUP_SOURCES }] = await Promise.all([
    import('@/lib/mongodb'),
    import('@/models/Business'),
    import('@/models/Audit'),
    import('@/lib/freeCrm'),
    import('@/lib/admin/realAccounts'),
  ]);
  await dbConnect();
  const businesses: any[] = await Business.find({
    provisionedVia: { $in: [...FREE_SIGNUP_SOURCES] },
    isDeleted: { $ne: true },
    createdAt: { $gte: new Date(now.getTime() - 14 * DAY), $lte: new Date(now.getTime() - DAY) },
    $or: [{ freeReportNudgeCount: { $exists: false } }, { freeReportNudgeCount: { $lt: 2 } }],
  })
    .select('_id userId name createdAt freeReportNudgeCount')
    .limit(limit)
    .lean();
  let sent = 0;
  const { sendPushToBusinessUsers } = await import('@/services/push');
  for (const b of businesses) {
    try {
      const due = freeReportNudgeDue((now.getTime() - new Date(b.createdAt).getTime()) / DAY, b.freeReportNudgeCount ?? 0);
      if (!due || !b.userId) continue;
      if (await Audit.exists({ businessId: b._id })) {
        await Business.updateOne({ _id: b._id }, { $set: { freeReportNudgeCount: 2 } }); // has one — never nudge
        continue;
      }
      if (!(await freeCrm.freeCrmAllowed(String(b.userId), String(b._id)))) continue;
      await sendPushToBusinessUsers(String(b._id), {
        title: due === 1 ? 'Get your free Google profile report' : 'Your free report is one tap away',
        body:
          due === 1
            ? `See how ${b.name || 'your business'} shows up on Google and what to fix first. Pick your listing in the app.`
            : 'Customers search Google before they call. Pick your listing and we will show you what to fix — free.',
        data: { freeReport: '1' },
      });
      await Business.updateOne({ _id: b._id }, { $set: { freeReportNudgeCount: due, freeReportNudgedAt: now } });
      sent++;
    } catch (err) {
      console.warn('[free-report-nudge] skipped', String(b._id), (err as Error)?.message);
    }
  }
  return { checked: businesses.length, sent };
}
