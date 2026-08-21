import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { BookDemoButton } from '@/components/shared/BookDemoButton';

export default function DemoSuccessPage() {
  return (
    <main className="theme-marketing min-h-screen bg-[#f7faf8]">
      <Navbar />
      <div className="pt-28 pb-20 px-4 flex flex-col items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg border border-[#e0e3e1] p-10 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-[#e8f8ee] rounded-full flex items-center justify-center mx-auto mb-6">
            <MaterialIcon name="check_circle" size={40} className="text-[#06b34c]" />
          </div>
          <h1 className="font-heading text-3xl font-extrabold text-[#181c1c] mb-3">Demo Booked!</h1>
          <p className="text-[#3d4a3d] mb-6 text-lg">
            Thank you for your interest. A confirmation email has been sent to you.
          </p>
          <div className="bg-[#f7faf8] rounded-xl p-5 mb-8 border border-[#e0e3e1] text-left">
            <p className="text-sm text-[#3d4a3d]">
              Our team will review your request and a platform expert will reach out shortly to coordinate your demo session.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 w-full bg-[#06b34c] text-white font-bold py-3.5 rounded-lg hover:bg-[#059640] transition-colors"
            >
              Return to Homepage
              <MaterialIcon name="arrow_forward" size={18} />
            </Link>
            <BookDemoButton
              origin="demo-success"
              className="w-full px-6 py-3 rounded-lg border-2 border-[#006e2c] text-[#006e2c] font-semibold hover:bg-white transition-colors"
            />
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}
