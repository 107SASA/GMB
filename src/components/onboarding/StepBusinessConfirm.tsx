import { useState } from 'react';
import { OnboardingData } from './types';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { motion } from 'framer-motion';

const inputCls =
  'w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

/**
 * Second half of what used to be one busy StepBusiness screen — review/edit
 * whatever StepBusinessSearch found (or a blank form, for "enter manually").
 * Same fields and validation as before, just its own step.
 */
export default function StepBusinessConfirm({ data, updateData, onNext, onBack }: Props) {
  const [error, setError] = useState('');

  const handleContinue = () => {
    // Category/description are NOT required here — Google's Places data only
    // has them for a minority of listings, so forcing every user to type
    // them in manually during signup was pure friction. They're collected
    // properly in the post-payment intake form instead.
    if (!data.businessName || !data.phone || !data.city || !data.area) {
      setError('Please fill in all required fields: Business Name, Phone, City, and Area.');
      return;
    }
    if (!PHONE_REGEX.test(normalizePhone(data.phone))) {
      setError('Please enter a valid phone number in international format, e.g. +14155550100.');
      return;
    }
    setError('');
    onNext();
  };

  return (
    <div className="h-full bg-surface-container-lowest rounded-xl card-shadow p-10 flex flex-col border border-outline-variant relative">
      <div className="flex-1 custom-scrollbar overflow-y-auto pr-2 pb-4">
        <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center mb-6">
          <MaterialIcon name="edit_note" size={24} className="text-primary" />
        </div>
        <h2 className="text-headline-md font-heading text-on-surface mb-2">Confirm your details</h2>
        <p className="text-on-surface-variant mb-8">Review what we found, and fill in anything missing.</p>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {data.googlePlaceId && (
            <div className="p-4 bg-secondary-container/40 border border-secondary-fixed rounded-lg flex items-start gap-3 mb-6">
              <MaterialIcon name="check_circle" size={20} className="text-secondary mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-bold text-on-secondary-container">Connected to Google Maps</div>
                <div className="text-xs text-secondary mt-0.5">We&apos;ve auto-filled your details. Please provide the remaining information below.</div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-label-md text-on-surface mb-2">Business Name *</label>
              <input
                type="text"
                value={data.businessName}
                onChange={e => updateData({ businessName: e.target.value })}
                className={inputCls}
                placeholder="e.g. Acme Downtown"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-label-md text-on-surface mb-2">City *</label>
                <input
                  type="text"
                  value={data.city}
                  onChange={e => updateData({ city: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. Pune"
                />
              </div>
              <div>
                <label className="block text-label-md text-on-surface mb-2">Area / Locality *</label>
                <input
                  type="text"
                  value={data.area}
                  onChange={e => updateData({ area: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. PCMC"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-label-md text-on-surface mb-2">State</label>
                <input
                  type="text"
                  value={data.state}
                  onChange={e => updateData({ state: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. Maharashtra"
                />
              </div>
              <div>
                <label className="block text-label-md text-on-surface mb-2">Country</label>
                <input
                  type="text"
                  value={data.country}
                  onChange={e => updateData({ country: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. India"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-label-md text-on-surface mb-2">Phone Number *</label>
                <input
                  type="tel"
                  value={data.phone}
                  onChange={e => updateData({ phone: e.target.value })}
                  className={inputCls}
                  placeholder="+1 (555) 000-0000"
                />
              </div>
              <div>
                <label className="block text-label-md text-on-surface mb-2">Website</label>
                <input
                  type="text"
                  value={data.website}
                  onChange={e => updateData({ website: e.target.value })}
                  className={inputCls}
                  placeholder="https://acme.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-label-md text-on-surface mb-2">Full Address</label>
              <input
                type="text"
                value={data.address}
                onChange={e => updateData({ address: e.target.value })}
                className={inputCls}
                placeholder="123 Main St, City, State"
              />
            </div>

            {!data.googlePlaceId && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-label-md text-on-surface mb-2">Google Place ID</label>
                  <input
                    type="text"
                    value={data.googlePlaceId}
                    onChange={e => updateData({ googlePlaceId: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-label-md text-on-surface mb-2">Google Maps URL</label>
                  <input
                    type="text"
                    value={data.googleMapsUrl}
                    onChange={e => updateData({ googleMapsUrl: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>

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

      <div className="flex justify-between items-center pt-6 border-t border-outline-variant mt-auto">
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
