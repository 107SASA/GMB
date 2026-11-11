# Growth Partner Program — how it works

For the Growwmatics AI team (super admins). Partners are digital marketing
agencies, freelancers or individuals who bring us customers and earn
commission on what those customers pay.

## The partner's journey

1. **Apply** — `growwmatics.ai/growth-partner` → *Apply now*. Form: type, name,
   email, mobile, company, website (optional), city, state, message.
   We email them "received" and alert `ADMIN_EMAIL`.
2. **You approve** — Admin → **Growth Partners → Applications**. *Approve*
   asks for that partner's terms (there is no default):
   - first-payment commission %
   - recurring commission % (every renewal)
   - hold period in days (refund window before a commission can be paid)
   - optional recurring limit in months (empty = for as long as they pay)

   Approval creates the partner (code `GP-XXXXXX`) and emails a one-time
   account link (valid 7 days; *Resend link* on the Partners tab makes a new
   one). *Reject* emails them your reason.
   An email that already has a Growwmatics customer account can't be approved
   — ask the applicant to use another email.
3. **Account** — the link opens *Create your partner account*: the email is
   fixed to the approved one; they choose a password. They sign in at
   `growwmatics.ai/partner-login` (not the customer login — each refuses the
   other's accounts).
4. **KYC** — *KYC & Bank* in their dashboard: company or individual, PAN,
   Aadhaar (individuals), bank account, and documents. You review it from the
   Partners tab (*Review KYC*): verify, or send back with what to fix. Payouts
   need verified KYC. Changing a verified KYC sends it back for review.
5. **Bring customers** — two ways:
   - **Add leads** in their CRM (Leads, Pipeline, CSV import). These leads are
     the partner's: **our AI never messages them** (no sales agent, drips,
     follow-ups or campaigns). A number already in our pipeline can't be added.
   - **Referral link** `growwmatics.ai/p/GP-XXXXXX` (or `?ref=GP-XXXXXX` on any
     page). Anyone who opens it and then requests the free report, books a
     demo or signs up within **30 days** is credited to the partner — first
     partner wins, and nothing already in our pipeline is re-assigned. These
     leads **keep our normal funnel** (the AI helps them); the partner can add
     notes and follow-ups but doesn't move them.
6. **Earn** — every payment by a customer they brought (first payment and
   renewals) creates a commission automatically.

## Commissions

- One per customer payment (per company invoice) — never twice for the same
  payment. Created right after the invoice; a daily sweep catches misses.
- First payment → first-payment %; later payments → recurring %. Base = amount
  received excluding GST. The rate is the one in force **on the payment date**
  — changing a partner's terms never changes earlier commissions.
- Credited to the partner on the customer's lead, otherwise the partner whose
  link the workspace signed up through.
- **On hold** until payment date + hold days, then **Ready for approval**.

Admin → **Growth Partners → Commissions & payouts**:

| Action | What it does |
|---|---|
| Approve ready / Approve selected | Moves commissions past their hold period to *Approved* |
| Reverse | Refund or mistake. Not paid yet → cancelled. Already paid → a negative adjustment comes off the partner's next payout |
| Record payout | **Send the money from the bank first**, then enter UTR, date, method, optional TDS %. Pays every approved commission for that partner and emails them. Needs verified KYC; blocked for suspended partners |
| Export CSV | Payout history for accounts |

**Refunds are not automatic** — when you refund a customer, also *Reverse*
that commission.

TDS: not decided yet; the payout box defaults to 0%.

## Where partner leads show for us

Leads & Pipeline shows a **Partner · company** badge and a **Partner** filter
(yes / no). *Leads* on a partner's row opens just their leads. *Return to AI*
and the nurture switch are refused for leads a partner added.

## Suspending a partner

Partners tab → *Suspend*: signs them out everywhere and blocks login and
payouts. Commissions keep being recorded. *Reactivate* to undo.

## Sidebar badge

The number on **Growth Partners** = new applications + KYC to review +
commissions ready to approve.

## Code map

| Area | Where |
|---|---|
| Rules (pure, tested) | `src/lib/partners/` |
| Services | `src/services/partners/` |
| Models | `GrowthPartner`, `PartnerApplication`, `PartnerInvite`, `PartnerCommission`, `PartnerPayout`; `Lead.partnerId/partnerSource`, `Business.partnerId` |
| Partner pages / APIs | `src/app/partner/`, `src/app/api/partner/` |
| Admin | `src/app/admin/growth-partners/`, `src/app/api/admin/growth-partners/`, `src/components/admin/partners/` |
| AI stays off for partner-added leads | `setLeadOwnership` + `isPartnerManagedLead()` |
| Commission hook | `src/services/inngest/invoiceFunctions.ts` |
| Tests | `tests/integration/growth-partner-*.test.ts` |
