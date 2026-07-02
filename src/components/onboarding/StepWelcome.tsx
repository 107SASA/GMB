import React from 'react';
import { OnboardingData } from './types';
import { ArrowRight, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

export default function StepWelcome({ onNext }: any) {
  return (
    <div className="h-full flex flex-col justify-center items-center text-center px-8">
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-8 shadow-xl shadow-slate-900/20"
      >
        <Sparkles className="text-white w-8 h-8" />
      </motion.div>
      
      <motion.h1 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-4xl font-bold text-slate-900 tracking-tight mb-4"
      >
        Welcome to GMBBoost
      </motion.h1>
      
      <motion.p 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-lg text-slate-500 mb-10 max-w-md"
      >
        Let's set up your automated AI growth system. This will only take a few minutes.
      </motion.p>
      
      <motion.button
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        onClick={onNext}
        className="flex items-center gap-2 px-8 py-4 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg hover:-translate-y-1"
      >
        Let's Get Started <ArrowRight className="w-5 h-5" />
      </motion.button>
    </div>
  );
}
