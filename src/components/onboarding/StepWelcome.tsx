import React from 'react';
import { OnboardingData } from './types';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { motion } from 'framer-motion';

export default function StepWelcome({ onNext }: any) {
  return (
    <div className="h-full flex flex-col justify-center items-center text-center px-8">
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="w-16 h-16 bg-primary rounded-xl flex items-center justify-center mb-8"
      >
        <MaterialIcon name="auto_awesome" size={32} className="text-on-primary" />
      </motion.div>
      
      <motion.h1 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-headline-lg font-heading text-on-surface tracking-tight mb-4"
      >
        Welcome to GrowwMatics AI
      </motion.h1>
      
      <motion.p 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-lg text-on-surface-variant mb-10 max-w-md"
      >
        Let&apos;s set up your automated AI growth system. This will only take a few minutes.
      </motion.p>
      
      <motion.button
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        onClick={onNext}
        className="flex items-center gap-2 px-8 py-3.5 bg-primary hover:bg-primary-container text-on-primary rounded-lg font-bold transition-all"
      >
        Let&apos;s Get Started <MaterialIcon name="arrow_forward" size={20} />
      </motion.button>
    </div>
  );
}
