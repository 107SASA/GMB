'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';

export default function AdminLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // DEV MODE BYPASS — matches existing login page pattern
    setTimeout(() => {
      router.push('/admin/dashboard');
      router.refresh();
    }, 500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-8 sm:p-10">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-violet-600 rounded-2xl mx-auto flex items-center justify-center mb-6 shadow-lg shadow-violet-600/20">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Super Admin</h1>
          <p className="text-sm text-slate-500">Restricted access — authorised personnel only.</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Email Address</label>
            <input
              type="email"
              required
              defaultValue="superadmin@gmbboost.com"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-violet-600 focus:border-transparent outline-none transition-all font-medium text-slate-900 placeholder-slate-400"
              placeholder="admin@yourdomain.com"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Password</label>
            <input
              type="password"
              required
              defaultValue="superadmin123"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-violet-600 focus:border-transparent outline-none transition-all font-medium text-slate-900 placeholder-slate-400"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center py-3.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md shadow-violet-600/20 transition-all disabled:opacity-70"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Sign In to Admin Panel'}
          </button>
        </form>

        <p className="text-center text-xs font-medium text-slate-400 mt-8">
          Regular users:{' '}
          <a href="/login" className="text-indigo-600 hover:text-indigo-700">
            Sign in here
          </a>
        </p>
      </div>
    </div>
  );
}
