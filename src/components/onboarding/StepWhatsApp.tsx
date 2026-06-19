import React, { useState } from 'react';
import { OnboardingData } from './types';
import { ArrowRight, MessageSquare, Link as LinkIcon, Camera, Globe } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepWhatsApp({ data, updateData, onNext, onBack }: Props) {
  const [error, setError] = useState('');

  const handleContinue = () => {
    // Note: All fields are optional right now so they can skip
    onNext();
  };

  return (
    <div className="h-full bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-10 flex flex-col border border-slate-100">
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-4">
        <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center mb-6">
          <MessageSquare className="text-green-600 w-6 h-6" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Connect Meta Business</h2>
        <p className="text-slate-500 mb-8">
          This connects your AI Sales Agent with your official WhatsApp Business profile. You can skip this and configure it later.
        </p>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">WhatsApp Business Number</label>
            <input
              type="tel"
              value={data.whatsappBusinessNumber}
              onChange={e => updateData({ whatsappBusinessNumber: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all outline-none"
              placeholder="+14155238886"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">Meta Business Profile URL (Optional)</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <LinkIcon className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="url"
                value={data.metaBusinessProfileUrl}
                onChange={e => updateData({ metaBusinessProfileUrl: e.target.value })}
                className="w-full pl-10 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all outline-none text-sm"
                placeholder="https://business.facebook.com/..."
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-600" /> Facebook Page (Optional)
              </label>
              <input
                type="url"
                value={data.facebookPageUrl}
                onChange={e => updateData({ facebookPageUrl: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none text-sm"
                placeholder="https://facebook.com/..."
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
                <Camera className="w-4 h-4 text-pink-600" /> Instagram URL (Optional)
              </label>
              <input
                type="url"
                value={data.instagramUrl}
                onChange={e => updateData({ instagramUrl: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all outline-none text-sm"
                placeholder="https://instagram.com/..."
              />
            </div>
          </div>
        </motion.div>
      </div>

      <div className="flex justify-between items-center pt-8 border-t border-slate-100 mt-auto">
        <button onClick={onBack} className="text-slate-500 font-bold hover:text-slate-900 transition-colors px-4 py-2">
          Back
        </button>
        <div className="flex items-center gap-4">
          <button onClick={onNext} className="text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors">
            Skip for now
          </button>
          <button 
            onClick={handleContinue}
            className="flex items-center gap-2 px-8 py-3.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-md"
          >
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
