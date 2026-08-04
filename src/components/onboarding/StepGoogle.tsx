import React, { useState } from 'react';
import { OnboardingData } from './types';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const inputCls =
  'w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all';

export default function StepGoogle({ data, updateData, onNext, onBack }: Props) {
  const [error, setError] = useState('');

  const handleContinue = () => {
    onNext(); // Making this optional for smooth UX
  };

  return (
    <div className="h-full bg-surface-container-lowest rounded-xl card-shadow p-10 flex flex-col border border-outline-variant">
      <div className="flex-1">
        <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center mb-6">
          <MaterialIcon name="star" size={24} className="text-primary" />
        </div>
        <h2 className="text-headline-md font-heading text-on-surface mb-2">Connect Google Profile</h2>
        <p className="text-on-surface-variant mb-8">This helps our AI fetch your reviews and optimize your local SEO rankings automatically.</p>

        <div className="space-y-5">
          <div>
            <label className="block text-label-md text-on-surface mb-2">Google Place ID (Optional)</label>
            <input
              type="text"
              value={data.googlePlaceId}
              onChange={e => updateData({ googlePlaceId: e.target.value })}
              className={inputCls}
              placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
            />
          </div>
          <div>
            <label className="block text-label-md text-on-surface mb-2">Public Review Link (Optional)</label>
            <input
              type="url"
              value={data.gbpUrl}
              onChange={e => updateData({ gbpUrl: e.target.value })}
              className={inputCls}
              placeholder="https://g.page/r/..."
            />
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center pt-8 border-t border-outline-variant">
        <button onClick={onBack} className="text-on-surface-variant font-bold hover:text-on-surface transition-colors px-4 py-2">
          Back
        </button>
        <button 
          onClick={handleContinue}
          className="flex items-center gap-2 px-8 py-3 bg-primary hover:bg-primary-container text-on-primary rounded-lg font-bold transition-all"
        >
          Continue <MaterialIcon name="arrow_forward" size={16} />
        </button>
      </div>
    </div>
  );
}
