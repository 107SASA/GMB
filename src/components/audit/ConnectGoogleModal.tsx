'use client';

import { X, Link2 } from 'lucide-react';
import Link from 'next/link';

interface ConnectGoogleModalProps {
  message: string;
  onClose: () => void;
}

export default function ConnectGoogleModal({ message, onClose }: ConnectGoogleModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/60 backdrop-blur-sm">
      <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-br from-primary to-primary-container px-6 pt-8 pb-10 text-center relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="w-14 h-14 bg-surface-container-lowest/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Link2 className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">Connect Google Business Profile</h2>
          <p className="text-on-primary-container text-sm">Required before running an audit</p>
        </div>

        <div className="-mt-5 mx-6 mb-6">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-4 mb-6">
            <p className="text-sm text-on-surface leading-relaxed">{message}</p>
          </div>

          <Link
            href="/dashboard/gbp-profile"
            className="block w-full py-2.5 text-sm font-bold text-white bg-primary rounded-xl hover:bg-primary-container transition-colors text-center"
            onClick={onClose}
          >
            Connect Google
          </Link>
        </div>
      </div>
    </div>
  );
}
