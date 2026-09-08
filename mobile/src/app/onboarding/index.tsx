import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { useBusiness } from '@/business/BusinessContext';
import type { PlaceDetails } from '@/api/endpoints/onboarding';
import { StepBusinessConfirm } from '@/components/onboarding/StepBusinessConfirm';
import { StepBusinessSearch } from '@/components/onboarding/StepBusinessSearch';
import { StepConnectGoogle } from '@/components/onboarding/StepConnectGoogle';
import { StepIntake } from '@/components/onboarding/StepIntake';
import { LoadingScreen, Screen } from '@/components/ui';

type Phase = 'search' | 'confirm' | 'intake' | 'google' | 'done';

/** Ordered labels for the progress row — 'done' is not shown as a step. */
const PHASE_ORDER: Phase[] = ['search', 'confirm', 'intake', 'google'];
const PHASE_LABELS: Record<Phase, string> = {
  search: 'Find business',
  confirm: 'Confirm details',
  intake: 'About your business',
  google: 'Connect Google',
  done: '',
};

export default function OnboardingWizard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const { onboardingStep, selectBusiness } = useBusiness();

  // The starting phase is fixed once, on mount — `onboardingStep` recomputes
  // as the wizard progresses and must not yank the user backwards.
  const initialPhase = useRef<Phase>(onboardingStep === 'intake' ? 'intake' : 'search').current;
  const [phase, setPhase] = useState<Phase>(initialPhase);

  const [place, setPlace] = useState<{ placeId: string; details: PlaceDetails } | null>(null);

  const visibleSteps = useMemo(
    () => PHASE_ORDER.filter((p) => (initialPhase === 'intake' ? p === 'intake' || p === 'google' : true)),
    [initialPhase],
  );

  async function finish() {
    // Refetch everything the gate depends on so needsOnboarding flips false,
    // then leave the wizard. Done here (not after the intake save) so the
    // optional Google step isn't skipped by an early redirect.
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ['businesses'] }),
      refreshUser(),
    ]);
    router.replace('/dashboard');
  }

  if (phase === 'done') return <LoadingScreen />;

  return (
    <Screen>
      <View className="px-5 pb-2 pt-4">
        <Text className="font-display text-[26px] leading-[32px] text-white">
          Finish setting up
        </Text>
        <ProgressRow steps={visibleSteps} current={phase} />
      </View>

      {phase === 'search' && (
        <StepBusinessSearch
          onSelected={(placeId, details) => {
            setPlace({ placeId, details });
            setPhase('confirm');
          }}
        />
      )}

      {phase === 'confirm' && place && (
        <StepBusinessConfirm
          placeId={place.placeId}
          details={place.details}
          onBack={() => setPhase('search')}
          onCreated={async (businessId) => {
            await selectBusiness(businessId);
            setPhase('intake');
          }}
        />
      )}

      {phase === 'intake' && (
        <StepIntake
          seed={place?.details ?? null}
          onSaved={() => setPhase('google')}
        />
      )}

      {phase === 'google' && (
        <StepConnectGoogle onDone={finish} />
      )}
    </Screen>
  );
}

function ProgressRow({ steps, current }: { steps: Phase[]; current: Phase }) {
  const currentIndex = steps.indexOf(current);
  return (
    <View className="mt-3 flex-row items-center gap-2">
      {steps.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <View key={step} className="flex-1 gap-1.5">
            <View
              className={`h-1 rounded-full ${
                done ? 'bg-secondary' : active ? 'bg-brand' : 'bg-surface-border'
              }`}
            />
            <Text
              className={`font-sans text-[10px] ${
                active ? 'text-brand-bright' : done ? 'text-secondary' : 'text-zinc-600'
              }`}
              numberOfLines={1}
            >
              {PHASE_LABELS[step]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
