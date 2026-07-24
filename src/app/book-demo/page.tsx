'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Calendar, Clock, Building,
  User, Phone, Mail, MessageSquare, Star, MapPin, Globe, TrendingUp
} from 'lucide-react';

const TIME_SLOTS = [
  '10:00 AM', '11:00 AM', '12:00 PM',
  '2:00 PM',  '3:00 PM',  '4:00 PM', '5:00 PM'
];

const BUSINESS_TYPES = [
  'Salon & Spa', 'Restaurant', 'Hotel',
  'Clinic', 'Gym', 'Retail Store', 'Other'
];

const MONTHLY_LEADS_OPTIONS = [
  '0 - 50', '51 - 200', '201 - 500', '500+'
];

export default function DemoPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', company: '',
    businessType: '', location: '', website: '',
    monthlyLeads: '', challenges: '', date: '', timeSlot: ''
  });

  const today = new Date().toISOString().split('T')[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.businessType) return alert('Please select a business category');
    if (!form.timeSlot) return alert('Please select a time slot');
    
    setLoading(true);
    try {
      const res = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        router.push('/demo-success');
      } else {
        alert(data.error || 'Something went wrong');
      }
    } catch {
      alert('Failed to book demo. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 py-10 px-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
            <Star size={20} className="text-white" fill="white" />
          </div>
          <span className="text-xl font-bold text-slate-800 tracking-tight">GrowwMatics AI</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-3 tracking-tight">Book a Free Demo</h1>
        <p className="text-slate-500 text-lg max-w-xl mx-auto">See how our AI-powered platform can automate your local growth and convert leads instantly.</p>
      </div>

      {/* Form */}
      <div className="max-w-3xl mx-auto p-6 py-12">
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-3xl p-8 md:p-10 shadow-sm space-y-8">
          
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2">1. Your Details</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                  <User size={14} className="text-indigo-500" /> Full Name *
                </label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  placeholder="John Doe"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                  <Mail size={14} className="text-indigo-500" /> Work Email *
                </label>
                <input
                  required type="email"
                  value={form.email}
                  onChange={e => setForm({...form, email: e.target.value})}
                  placeholder="john@company.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                  <Phone size={14} className="text-indigo-500" /> Phone Number *
                </label>
                <input
                  required
                  value={form.phone}
                  onChange={e => setForm({...form, phone: e.target.value})}
                  placeholder="+1 (555) 000-0000"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                  <Building size={14} className="text-indigo-500" /> Business Name *
                </label>
                <input
                  required
                  value={form.company}
                  onChange={e => setForm({...form, company: e.target.value})}
                  placeholder="Glamour Salon"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                  <MapPin size={14} className="text-indigo-500" /> Location *
                </label>
                <input
                  required
                  value={form.location}
                  onChange={e => setForm({...form, location: e.target.value})}
                  placeholder="City, Country"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                  <Globe size={14} className="text-slate-400" /> Website (Optional)
                </label>
                <input
                  value={form.website}
                  onChange={e => setForm({...form, website: e.target.value})}
                  placeholder="https://company.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>
            </div>
          </div>

          <div className="space-y-6 pt-4">
            <h3 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2">2. Business Profile</h3>
            
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-3">
                Business Category *
              </label>
              <div className="flex flex-wrap gap-2.5">
                {BUSINESS_TYPES.map(type => (
                  <button
                    key={type} type="button"
                    onClick={() => setForm({...form, businessType: type})}
                    className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all shadow-sm
                      ${form.businessType === type
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-indigo-600/20'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/50'}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-3">
                <TrendingUp size={14} className="text-slate-400" /> Current Monthly Leads (Optional)
              </label>
              <div className="flex flex-wrap gap-2.5">
                {MONTHLY_LEADS_OPTIONS.map(opt => (
                  <button
                    key={opt} type="button"
                    onClick={() => setForm({...form, monthlyLeads: opt})}
                    className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all shadow-sm
                      ${form.monthlyLeads === opt
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-indigo-600/20'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/50'}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                <MessageSquare size={14} className="text-slate-400" /> Current Challenges (Optional)
              </label>
              <textarea
                value={form.challenges} rows={3}
                onChange={e => setForm({...form, challenges: e.target.value})}
                placeholder="What are the biggest challenges you're facing with customer acquisition or reviews?"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all resize-none"
              />
            </div>
          </div>

          <div className="space-y-6 pt-4">
            <h3 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2">3. Schedule Demo</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-3">
                  <Calendar size={14} className="text-indigo-500" /> Preferred Date *
                </label>
                <input
                  required type="date"
                  value={form.date} min={today}
                  onChange={e => setForm({...form, date: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-3">
                  <Clock size={14} className="text-indigo-500" /> Preferred Time *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {TIME_SLOTS.map(slot => (
                    <button
                      key={slot} type="button"
                      onClick={() => setForm({...form, timeSlot: slot})}
                      className={`py-2.5 rounded-xl text-xs font-bold border transition-all shadow-sm
                        ${form.timeSlot === slot
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-indigo-600/20'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/50'}`}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-8">
            <button
              type="submit" disabled={loading}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-2xl text-base flex items-center justify-center gap-2 transition-all shadow-xl shadow-slate-900/20 disabled:opacity-70"
            >
              {loading
                ? <Loader2 size={20} className="animate-spin" />
                : <Calendar size={20} />}
              Confirm Demo Booking
            </button>
            <p className="text-center text-sm font-medium text-slate-500 mt-4">
              100% Free Demo. No credit card required.
            </p>
          </div>

        </form>
      </div>
    </div>
  );
}