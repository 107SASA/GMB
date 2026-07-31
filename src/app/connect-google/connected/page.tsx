import { CheckCircle2 } from 'lucide-react';

export default function ConnectedPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 p-10 text-center">
        <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-7 h-7 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">You're connected!</h1>
        <p className="text-slate-500">
          Head back to WhatsApp — your report is generating now and we'll send it to you there shortly.
        </p>
      </div>
    </div>
  );
}
