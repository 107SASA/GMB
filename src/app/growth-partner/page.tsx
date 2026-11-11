import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

const BENEFITS = [
  {
    icon: 'payments',
    title: 'Recurring commission',
    detail: 'Earn on the first payment and on every renewal, for as long as the customer keeps paying.',
  },
  {
    icon: 'view_kanban',
    title: 'Your own CRM',
    detail: 'Add leads, move them through your pipeline and track every customer you bring, in one dashboard.',
  },
  {
    icon: 'verified',
    title: 'Clear, tracked payouts',
    detail: 'See every commission as it is earned, approved and paid, straight to your bank account.',
  },
];

const STEPS = [
  { title: 'Apply', detail: 'Tell us about you and your company. It takes two minutes.' },
  { title: 'Get approved', detail: 'Our team reviews your application and emails you a link to create your account.' },
  { title: 'Complete KYC', detail: 'Add your company or personal documents and bank details for payouts.' },
  { title: 'Bring customers', detail: 'Add leads, close them, and earn commission on every payment they make.' },
];

const WHO = [
  'Digital marketing agencies',
  'SEO & local-listing consultants',
  'Web designers and developers',
  'Freelancers working with local businesses',
];

export default function GrowthPartnerPage() {
  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed">
      <Navbar />

      <section className="relative pt-24 sm:pt-28 md:pt-32 pb-12 sm:pb-16 px-4 sm:px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto">
          <p className="mkt-label flex items-center gap-3 text-[#6b756f] mb-4 sm:mb-5">
            <span className="w-6 h-px bg-[#006e2c]" />
            Growth Partner Program
          </p>
          <h1 className="font-mkt-display text-[1.75rem] sm:text-4xl md:text-5xl font-semibold text-[#101613] mb-5 leading-[1.15] tracking-tight max-w-3xl">
            Bring businesses to <span className="text-[#006e2c]">Growwmatics AI</span>. Earn on every payment.
          </h1>
          <p className="text-[#3d4a3d] text-base sm:text-lg max-w-2xl mb-8">
            Partner with us to help local businesses grow on Google. You bring the customer, and we pay you commission on
            their first payment and on every renewal after that.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/growth-partner/apply"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-[#006e2c] text-white rounded-lg font-bold hover:bg-[#005a24] transition-all min-h-[48px]"
            >
              Apply now
              <MaterialIcon name="arrow_forward" size={16} className="text-white" />
            </Link>
            <Link
              href="/partner-login"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 border border-(--mkt-line) text-[#101613] bg-white rounded-lg font-bold hover:bg-(--mkt-surface) transition-all min-h-[48px]"
            >
              Partner login
            </Link>
          </div>
        </div>
      </section>

      <section className="px-4 sm:px-6 md:px-12 pb-12 sm:pb-16">
        <div className="max-w-[1280px] mx-auto grid gap-4 sm:grid-cols-3">
          {BENEFITS.map((b) => (
            <div key={b.title} className="bg-white rounded-xl border border-(--mkt-line) p-6">
              <div className="w-11 h-11 rounded-lg bg-[#e8f8ee] flex items-center justify-center mb-4">
                <MaterialIcon name={b.icon} size={22} className="text-[#006e2c]" />
              </div>
              <h2 className="font-mkt-display text-lg font-semibold text-[#101613] mb-1.5">{b.title}</h2>
              <p className="text-sm text-[#3d4a3d] leading-relaxed">{b.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4 sm:px-6 md:px-12 pb-12 sm:pb-16">
        <div className="max-w-[1280px] mx-auto grid lg:grid-cols-2 gap-8 lg:gap-16">
          <div>
            <h2 className="font-mkt-display text-2xl sm:text-3xl font-semibold text-[#101613] mb-6">How it works</h2>
            <ol className="flex flex-col gap-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex items-start gap-4 bg-white rounded-xl border border-(--mkt-line) p-4">
                  <span className="font-mkt-mono text-xs text-[#006e2c] font-bold shrink-0 mt-1">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-[#101613]">{s.title}</p>
                    <p className="text-sm text-[#3d4a3d]">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="font-mkt-display text-2xl sm:text-3xl font-semibold text-[#101613] mb-6">Who can apply</h2>
            <ul className="flex flex-col gap-3 mb-8">
              {WHO.map((w) => (
                <li key={w} className="flex items-center gap-3 text-[#101613]">
                  <MaterialIcon name="check_circle" size={20} className="text-[#006e2c] shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-[#3d4a3d] mb-6">
              Individuals can apply too. Every application is reviewed by our team, and your commission terms are agreed
              with you on approval.
            </p>
            <Link
              href="/growth-partner/apply"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-[#006e2c] text-white rounded-lg font-bold hover:bg-[#005a24] transition-all min-h-[48px]"
            >
              Apply to become a partner
              <MaterialIcon name="arrow_forward" size={16} className="text-white" />
            </Link>
          </div>
        </div>
      </section>

      <Footer hideBoosterPromo />
    </main>
  );
}
