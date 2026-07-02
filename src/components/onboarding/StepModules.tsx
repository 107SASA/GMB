import React from 'react';
import { OnboardingData } from './types';
import { ArrowRight, Layers, CheckCircle2 } from 'lucide-react';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepModules({ data, updateData, onNext, onBack }: Props) {
  const plans = [
    { id: 'starter', name: 'Starter', price: '$49/mo', features: ['Review Management', 'Basic AI Replies', '1 Location'] },
    { id: 'growth', name: 'Growth', price: '$99/mo', features: ['WhatsApp CRM', 'AI Content Scheduler', 'Unlimited SMS'] },
    { id: 'enterprise', name: 'Enterprise', price: '$299/mo', features: ['White-label', 'Custom AI Models', 'Priority Support'] }
  ];

  return (
    <div className="h-full bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-10 flex flex-col border border-slate-100">
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-4">
        <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center mb-6">
          <Layers className="text-purple-600 w-6 h-6" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Select Your Blueprint</h2>
        <p className="text-slate-500 mb-8">Choose the modules you want active for your workspace. (Don't worry, you're on a 14-day free trial).</p>

        <div className="space-y-4">
          {plans.map(plan => (
            <button
              key={plan.id}
              onClick={() => updateData({ selectedPlan: plan.id })}
              className={`w-full text-left p-5 rounded-2xl border-2 transition-all flex items-center justify-between ${
                data.selectedPlan === plan.id 
                  ? 'border-slate-900 bg-slate-50' 
                  : 'border-slate-100 hover:border-slate-200 bg-white'
              }`}
            >
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className={`font-bold text-lg ${data.selectedPlan === plan.id ? 'text-slate-900' : 'text-slate-700'}`}>
                    {plan.name}
                  </div>
                  <div className="text-sm font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                    {plan.price}
                  </div>
                </div>
                <div className="text-xs text-slate-500 flex gap-2">
                  {plan.features.map((f, i) => (
                    <span key={i}>• {f}</span>
                  ))}
                </div>
              </div>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                data.selectedPlan === plan.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-transparent'
              }`}>
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </button>
          ))}
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
          Review & Build <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
