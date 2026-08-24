import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { BookDemoButton } from '@/components/shared/BookDemoButton';

export default function DemoSuccessPage() {
  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface)">
      <Navbar />
      <div className="relative pt-28 pb-20 px-4 flex flex-col items-center justify-center">
        <div className="bg-white rounded-xl shadow-card border border-(--mkt-line) p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-[#e8f8ee] rounded-xl flex items-center justify-center mx-auto mb-6">
            <MaterialIcon name="check_circle" size={32} className="text-[#006e2c]" />
          </div>
          <p className="mkt-label text-[#006e2c] mb-2">Confirmed</p>
          <h1 className="font-mkt-display text-3xl font-semibold text-[#101613] mb-3">Demo booked!</h1>
          <p className="text-[#3d4a3d] mb-6 text-lg">
            Thank you for your interest. A confirmation email has been sent to you.
          </p>
          <div className="bg-(--mkt-surface) rounded-lg p-5 mb-8 border border-(--mkt-line) text-left">
            <p className="text-sm text-[#3d4a3d]">
              Our team will review your request and a platform expert will reach out shortly to coordinate your demo session.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 w-full bg-[#006e2c] text-white font-bold py-3.5 rounded-lg hover:bg-[#005a24] transition-colors"
            >
              Return to Homepage
              <MaterialIcon name="arrow_forward" size={18} />
            </Link>
            <BookDemoButton
              origin="demo-success"
              className="w-full px-6 py-3 rounded-lg border border-(--mkt-line) text-[#101613] font-semibold hover:border-[#006e2c] hover:text-[#006e2c] transition-colors"
            />
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}
