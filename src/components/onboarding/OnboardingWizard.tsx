'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { initialOnboardingData, OnboardingData } from './types';
import { Rocket } from 'lucide-react';

import StepWelcome from './StepWelcome';
import StepAccount from './StepAccount';
import StepPassword from './StepPassword';
import StepBusiness from './StepBusiness';
import StepGoogle from './StepGoogle';
import StepWhatsApp from './StepWhatsApp';
import StepAI from './StepAI';
import StepModules from './StepModules';
import StepCompletion from './StepCompletion';

export function OnboardingWizard() {
  const [data, setData] = useState<OnboardingData>(initialOnboardingData);
  const [currentStep, setCurrentStep] = useState(0);

  const updateData = (fields: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...fields }));
  };

  const nextStep = () => setCurrentStep(prev => prev + 1);
  const prevStep = () => setCurrentStep(prev => Math.max(0, prev - 1));

  const steps = [
    { component: StepWelcome, id: 'welcome' },
    { component: StepAccount, id: 'account' },
    { component: StepPassword, id: 'password' },
    { component: StepBusiness, id: 'business' },
    { component: StepGoogle, id: 'google' },
    { component: StepWhatsApp, id: 'whatsapp' },
    { component: StepAI, id: 'ai' },
    { component: StepModules, id: 'modules' },
    { component: StepCompletion, id: 'complete' }
  ];

  const CurrentStepComponent = steps[currentStep].component;

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      {/* Premium Header */}
      <div className="absolute top-8 left-8 flex items-center gap-2">
        <div className="w-8 h-8 bg-white border border-slate-200 rounded-lg flex items-center justify-center shadow-sm">
          <Rocket className="text-slate-900 w-4 h-4" />
        </div>
        <span className="text-lg font-bold tracking-tight text-slate-900">GMBBoost</span>
      </div>

      <div className="w-full max-w-2xl">
        {/* Progress Tracker (Only show in middle steps) */}
        {currentStep > 0 && currentStep < steps.length - 1 && (
          <div className="mb-8">
            <div className="flex justify-between text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              <span>Step {currentStep} of {steps.length - 2}</span>
            </div>
            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${(currentStep / (steps.length - 2)) * 100}%` }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
                className="h-full bg-slate-900 rounded-full"
              />
            </div>
          </div>
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
