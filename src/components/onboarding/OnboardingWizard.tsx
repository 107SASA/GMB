'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { initialOnboardingData, OnboardingData } from './types';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

import StepWelcome from './StepWelcome';
import StepAccount from './StepAccount';
import StepPassword from './StepPassword';
import StepBusiness from './StepBusiness';
import StepGoogle from './StepGoogle';
import StepCompletion from './StepCompletion';

const STEPPER_STEPS = [
  { id: 'account', label: 'Account' },
  { id: 'password', label: 'Password' },
  { id: 'business', label: 'Business' },
  { id: 'google', label: 'Google' },
];

export function OnboardingWizard() {
  const [data, setData] = useState<OnboardingData>(initialOnboardingData);
  const [currentStep, setCurrentStep] = useState(0);

  const updateData = (fields: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...fields }));
  };

  const nextStep = () => setCurrentStep(prev => prev + 1);
  const prevStep = () => setCurrentStep(prev => Math.max(0, prev - 1));

  /**
   * No pricing step here, deliberately.
   *
   * Signup runs straight through to the free audit report, and the plan is only
   * offered alongside that finished report (AuditPaywallSidebar). Showing a
   * price before the user has seen any value gives them a reason to abandon
   * before they ever reach the thing that sells the product.
   *
   * No Meta Business/Facebook/Instagram step either, for the same reason —
   * every field on it was optional and most users skipped it anyway. Those
   * URLs (and the WhatsApp number, already covered by Settings' own field)
   * are collected later from Settings → Business Profile instead.
   */
  const steps = [
    { component: StepWelcome, id: 'welcome' },
    { component: StepAccount, id: 'account' },
    { component: StepPassword, id: 'password' },
    { component: StepBusiness, id: 'business' },
    { component: StepGoogle, id: 'google' },
    { component: StepCompletion, id: 'complete' }
  ];

  const CurrentStepComponent = steps[currentStep].component;
  const showStepper = currentStep > 0 && currentStep < steps.length - 1;
  const activeStepperIndex = currentStep - 1;

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-secondary/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="absolute top-8 left-8 flex items-center gap-2 z-10">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
          <MaterialIcon name="rocket_launch" size={16} className="text-on-primary" />
        </div>
        <span className="text-lg font-heading font-bold tracking-tight text-on-surface">
          Groww<span className="text-primary">Matics</span> AI
        </span>
      </div>

      <div className="w-full max-w-2xl relative z-10">
        {showStepper && (
          <nav aria-label="Onboarding progress" className="mb-8">
            <ol className="flex items-center w-full">
              {STEPPER_STEPS.map((step, index) => {
                const isComplete = index < activeStepperIndex;
                const isCurrent = index === activeStepperIndex;
                return (
                  <li
                    key={step.id}
                    className={`flex items-center ${index < STEPPER_STEPS.length - 1 ? 'flex-1' : ''}`}
                  >
                    <div className="flex flex-col items-center gap-1.5">
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                          isComplete
                            ? 'bg-secondary text-on-secondary'
                            : isCurrent
                              ? 'bg-primary text-on-primary'
                              : 'bg-surface-container-lowest border border-outline-variant text-on-surface-variant'
                        }`}
                      >
                        {isComplete ? (
                          <MaterialIcon name="check" size={16} />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span
                        className={`text-[10px] font-medium uppercase tracking-wider hidden sm:block ${
                          isCurrent ? 'text-primary' : isComplete ? 'text-secondary' : 'text-outline'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                    {index < STEPPER_STEPS.length - 1 && (
                      <div
                        className={`h-0.5 flex-1 mx-2 sm:mx-3 rounded-full ${
                          index < activeStepperIndex ? 'bg-secondary' : 'bg-outline-variant'
                        }`}
                        aria-hidden
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        <div className="relative w-full h-[600px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="absolute inset-0"
            >
              <CurrentStepComponent 
                data={data} 
                updateData={updateData} 
                onNext={nextStep} 
                onBack={prevStep} 
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
