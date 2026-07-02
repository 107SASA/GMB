import Link from 'next/link';
import { CheckCircle, ArrowRight } from 'lucide-react';

export default function DemoSuccessPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-10 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle size={40} className="text-green-600" />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 mb-3">Demo Booked!</h1>
        <p className="text-slate-500 mb-6 text-lg">
          Thank you for your interest. A confirmation email has been sent to you.
        </p>
        <div className="bg-slate-50 rounded-xl p-5 mb-8 border border-slate-100 text-left">
          <p className="text-sm text-slate-600">
            Our team will review your request and a platform expert will reach out shortly to coordinate your demo session via Google Meet.
          </p>
        </div>
        <Link 
          href="/"
          className="inline-flex items-center justify-center gap-2 w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition-colors shadow-md"
        >
          Return to Homepage
          <ArrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}
