import React from 'react';
import { OnboardingData } from './types';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

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
    <div className="h-full bg-surface-container-lowest rounded-xl card-shadow p-10 flex flex-col border border-outline-variant">
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-4">
        <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center mb-6">
          <MaterialIcon name="auto_awesome" size={24} className="text-primary" />
        </div>
        <h2 className="text-headline-md font-heading text-on-surface mb-2">Train your AI Agent</h2>
        <p className="text-on-surface-variant mb-8">Give your AI assistant a personality and core directive for responding to inbound leads.</p>

        <div className="space-y-6">
          <div>
            <label className="block text-label-md text-on-surface mb-3">Brand Tone of Voice</label>
            <div className="grid grid-cols-2 gap-3">
              {tones.map(tone => (
                <button
                  key={tone.id}
                  onClick={() => updateData({ aiTone: tone.id })}
                  className={`text-left p-4 rounded-lg border transition-all ${
                    data.aiTone === tone.id 
                      ? 'border-primary bg-primary-fixed' 
                      : 'border-outline-variant hover:border-outline bg-surface-container-lowest'
                  }`}
                >
                  <div className={`font-bold ${data.aiTone === tone.id ? 'text-primary' : 'text-on-surface'}`}>
                    {tone.label}
                  </div>
                  <div className="text-xs text-on-surface-variant mt-1">{tone.desc}</div>
                </button>
              ))}
            </div>
          </div>
          
          <div>
            <label className="block text-label-md text-on-surface mb-2">Custom Sales Prompt</label>
            <textarea
              rows={4}
              value={data.aiSalesPrompt}
              onChange={e => updateData({ aiSalesPrompt: e.target.value })}
              className="w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm resize-none"
              placeholder="e.g. Your primary goal is to book a viewing for our real estate listings. Never give exact pricing without getting an email first..."
            />
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center pt-8 border-t border-outline-variant mt-auto">
        <button onClick={onBack} className="text-on-surface-variant font-bold hover:text-on-surface transition-colors px-4 py-2">
          Back
        </button>
        <button 
          onClick={onNext}
          className="flex items-center gap-2 px-8 py-3 bg-primary hover:bg-primary-container text-on-primary rounded-lg font-bold transition-all"
        >
          Continue <MaterialIcon name="arrow_forward" size={16} />
        </button>
      </div>
    </div>
  );
}
