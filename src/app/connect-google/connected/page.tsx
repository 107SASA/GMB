import { MaterialIcon } from '@/components/ui/MaterialIcon';

export default function ConnectedPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-10 text-center">
        <div className="w-14 h-14 bg-secondary rounded-full flex items-center justify-center mx-auto mb-6">
          <MaterialIcon name="check_circle" size={28} className="text-on-secondary" />
        </div>
        <h1 className="text-headline-md font-heading text-on-surface mb-2">You&apos;re connected!</h1>
        <p className="text-on-surface-variant">
          Head back to WhatsApp — your report is generating now and we&apos;ll send it to you there shortly.
        </p>
      </div>
    </div>
  );
}
