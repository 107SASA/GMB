# Onboarding Architecture

## Overview
GMBBoost utilizes a state-machine architecture for its premium SaaS onboarding flow. Instead of a monolithic registration form, users are guided through a multi-step `Framer Motion` powered wizard.

## The Orchestrator (`OnboardingWizard.tsx`)
The `OnboardingWizard` is a client-side wrapper that holds the master `OnboardingData` state.
It stores an array of sub-components and dynamically renders them using an index (`currentStep`):
```typescript
  const steps = [
    { component: StepWelcome, id: 'welcome' },
    { component: StepAccount, id: 'account' },
    ...
  ]
```

## State Management
Each sub-component receives:
- `data`: The master state object.
- `updateData`: A partial state updater function.
- `onNext` / `onBack`: Navigation controllers.

This ensures all state is preserved if a user clicks "Back" to edit a previous field.

## Framer Motion Integration
The orchestrator uses `<AnimatePresence mode="wait">` to wrap the dynamic `CurrentStepComponent`.
As `currentStep` changes, the old component exits with an opacity fade and `-20px` X-axis slide, while the new component enters from `+20px`. This creates a seamless "Stripe-like" forward progression.
