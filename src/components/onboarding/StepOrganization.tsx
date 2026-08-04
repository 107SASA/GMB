import React, { useState } from 'react';
import { OnboardingData } from './types';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepOrganization({ data, updateData, onNext, onBack }: Props) {
  const [error, setError] = useState('');

  const handleContinue = () => {
    if (!data.companyName) {
      setError('Company name is required.');
      return;
    }
    setError('');
    onNext();
  };

  return (
    <div className="h-full bg-surface-container-lowest rounded-xl card-shadow p-10 flex flex-col border border-outline-variant">
      <div className="flex-1">
        <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center mb-6">
          <MaterialIcon name="business" size={24} className="text-primary" />
        </div>
        <h2 className="text-headline-md font-heading text-on-surface mb-2">Name your organization</h2>
        <p className="text-on-surface-variant mb-8">This is the parent company that will hold all your businesses and locations.</p>

        <div className="space-y-5">
          <div>
            <label className="block text-label-md text-on-surface mb-2">Company Name</label>
            <input
              type="text"
              value={data.companyName}
              onChange={e => updateData({ companyName: e.target.value })}
              className="w-full px-4 py-3 text-xl font-medium bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              placeholder="e.g. Acme Corp"
              autoFocus
            />
          </div>
        </div>
      </div>

      {/* Error sits directly above the Continue button so it is visible right
          where the user just clicked, instead of at the top of the form. */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-4 p-4 bg-error-container text-on-error-container rounded-lg text-sm font-medium border border-outline-variant flex items-start gap-3"
        >
          <MaterialIcon name="error" size={20} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-between items-center pt-6 border-t border-outline-variant">
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
