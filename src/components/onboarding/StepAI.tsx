import React from 'react';
import { OnboardingData } from './types';
import { ArrowRight, Sparkles } from 'lucide-react';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepAI({ data, updateData, onNext, onBack }: Props) {
  const tones = [
    { id: 'professional', label: 'Professional', desc: 'Formal and trustworthy' },
    { id: 'friendly', label: 'Friendly', desc: 'Warm and conversational' },
    { id: 'luxury', label: 'Luxury', desc: 'Exclusive and high-end' },
    { id: 'energetic', label: 'Energetic', desc: 'Enthusiastic and bold' }
  ];

  return (
    <div className="h-full bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-10 flex flex-col border border-slate-100">
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-4">
        <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mb-6">
          <Sparkles className="text-indigo-600 w-6 h-6" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Train your AI Agent</h2>
        <p className="text-slate-500 mb-8">Give your AI assistant a personality and core directive for responding to inbound leads.</p>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-3">Brand Tone of Voice</label>
            <div className="grid grid-cols-2 gap-3">
              {tones.map(tone => (
                <button
                  key={tone.id}
                  onClick={() => updateData({ aiTone: tone.id })}
                  className={`text-left p-4 rounded-xl border-2 transition-all ${
                    data.aiTone === tone.id 
                      ? 'border-indigo-600 bg-indigo-50/50' 
                      : 'border-slate-100 hover:border-slate-200 bg-white'
                  }`}
                >
                  <div className={`font-bold ${data.aiTone === tone.id ? 'text-indigo-900' : 'text-slate-900'}`}>
                    {tone.label}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{tone.desc}</div>
                </button>
              ))}
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">Custom Sales Prompt</label>
            <textarea
              rows={4}
              value={data.aiSalesPrompt}
              onChange={e => updateData({ aiSalesPrompt: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none text-sm resize-none"
              placeholder="e.g. Your primary goal is to book a viewing for our real estate listings. Never give exact pricing without getting an email first..."
            />
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center pt-8 border-t border-slate-100 mt-auto">
        <button onClick={onBack} className="text-slate-500 font-bold hover:text-slate-900 transition-colors px-4 py-2">
          Back
        </button>
        <button 
          onClick={onNext}
          className="flex items-center gap-2 px-8 py-3.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-md"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
