import type { Metadata } from 'next';
import SignupForm from './SignupForm';

export const metadata: Metadata = {
  title: 'Create a free account · Growwmatics AI',
  description: 'Free CRM and visiting-card scanner, plus a free Google profile report for your business.',
};

/** Website "Create free account" (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md, Door 2). */
export default function SignupPage() {
  return <SignupForm />;
}
