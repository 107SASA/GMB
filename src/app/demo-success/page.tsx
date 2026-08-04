import Link from 'next/link';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

export default function DemoSuccessPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-10 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-secondary-container rounded-full flex items-center justify-center mx-auto mb-6">
          <MaterialIcon name="check_circle" size={40} className="text-secondary" />
        </div>
        <h1 className="font-heading text-3xl font-extrabold text-on-surface mb-3">Demo Booked!</h1>
        <p className="text-on-surface-variant mb-6 text-lg">
          Thank you for your interest. A confirmation email has been sent to you.
        </p>
        <div className="bg-surface rounded-xl p-5 mb-8 border border-outline-variant text-left">
          <p className="text-sm text-on-surface-variant">
            Our team will review your request and a platform expert will reach out shortly to coordinate your demo session via Google Meet.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 w-full bg-primary text-on-primary font-bold py-3.5 rounded-lg hover:bg-primary-container transition-colors card-shadow"
        >
          Return to Homepage
          <MaterialIcon name="arrow_forward" size={18} />
        </Link>
      </div>
    </div>
  );
}
