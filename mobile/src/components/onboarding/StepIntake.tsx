import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  EMPTY_INTAKE,
  fetchIntake,
  saveIntake,
  suggestKeywords,
  type IntakeData,
  type PlaceDetails,
} from '@/api/endpoints/onboarding';
import { Chip, ErrorText, Field, LabeledField, LoadingScreen, PrimaryButton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

interface Props {
  seed: PlaceDetails | null;
  onSaved: () => void;
}

const GOALS: { id: string; label: string }[] = [
  { id: 'more_calls', label: 'More calls / enquiries' },
  { id: 'more_visits', label: 'More walk-ins' },
  { id: 'more_reviews', label: 'More & better reviews' },
  { id: 'higher_ranking', label: 'Higher Maps ranking' },
  { id: 'brand_awareness', label: 'Brand awareness' },
];

const TONES: { id: string; label: string }[] = [
  { id: 'professional', label: 'Professional' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'motivational', label: 'Motivational' },
  { id: 'luxury', label: 'Luxury' },
  { id: 'conversational', label: 'Conversational' },
];

const isValidKeyword = (v: string) => /[a-zA-Z]/.test(v);

/**
 * The "Tell us about your business" intake — the mobile counterpart of
 * dashboard/onboarding/intake. Same fields and validation; POST
 * /api/onboarding/intake marks intakeCompleted, which clears the onboarding
 * gate. Prefills from any answers already saved for this workspace, falling
 * back to the Google Places result the previous step passed through.
 */
export function StepIntake({ seed, onSaved }: Props) {
  const existing = useQuery({ queryKey: ['onboarding-intake'], queryFn: fetchIntake });

  if (existing.isLoading) return <LoadingScreen />;

  return (
    <IntakeForm
      key={existing.dataUpdatedAt}
      initial={mergeSeed(existing.data?.data ?? EMPTY_INTAKE, seed)}
      onSaved={onSaved}
    />
  );
}

function mergeSeed(data: IntakeData, seed: PlaceDetails | null): IntakeData {
  if (!seed) return data;
  return {
    ...data,
    category: data.category || seed.primaryCategory || '',
    description: data.description || seed.editorialSummary || '',
    city: data.city || seed.city || '',
    area: data.area || seed.area || '',
  };
}

function IntakeForm({ initial, onSaved }: { initial: IntakeData; onSaved: () => void }) {
  const t = useTheme();
  const [form, setForm] = useState<IntakeData>(initial);
  const [keywordInput, setKeywordInput] = useState('');
  const [competitorInput, setCompetitorInput] = useState('');
  const [suggested, setSuggested] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof IntakeData>(k: K, v: IntakeData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const shownKeywords = useRef(new Set<string>()).current;

  const suggest = useMutation({
    mutationFn: () =>
      suggestKeywords({
        category: form.category,
        description: form.description,
        selectedKeywords: form.keywords,
        excludeKeywords: [...shownKeywords],
      }),
    onSuccess: (keywords) => {
      keywords.forEach((k) => shownKeywords.add(k));
      setSuggested(keywords.filter((k) => !form.keywords.includes(k)));
    },
  });

  const save = useMutation({
    mutationFn: () => saveIntake(form),
    onSuccess: onSaved,
    onError: (err) => setError(getApiErrorMessage(err, 'Could not save. Please try again.')),
  });

  function addKeyword() {
    const v = keywordInput.trim();
    if (!v || !isValidKeyword(v) || form.keywords.includes(v)) {
      setKeywordInput('');
      return;
    }
    set('keywords', [...form.keywords, v]);
    setKeywordInput('');
  }

  function addCompetitor() {
    const v = competitorInput.trim();
    if (!v || form.competitorNames.includes(v)) {
      setCompetitorInput('');
      return;
    }
    set('competitorNames', [...form.competitorNames, v]);
    setCompetitorInput('');
  }

  function submit() {
    setError(null);
    if (!form.category.trim()) return setError('Please enter your business category.');
    if (form.description.trim().length < 10) return setError('Please describe your business (at least 10 characters).');
    if (form.services.trim().length < 3) return setError('List the services you offer.');
    if (form.keywords.length === 0) return setError('Add at least one target keyword.');
    save.mutate();
  }

  return (
    <ScrollView contentContainerClassName="px-5 pb-20 pt-2" keyboardShouldPersistTaps="handled">
      <Text className="mb-1 font-display-bold text-lg text-white">Tell us about your business</Text>
      <Text className="mb-5 font-sans text-sm leading-5 text-zinc-400">
        This powers your audits, AI content, and competitor comparison. ~2 minutes.
      </Text>

      <LabeledField
        label="Business category *"
        value={form.category}
        onChangeText={(v) => set('category', v)}
        placeholder="e.g. Restaurant"
      />

      <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">Business description *</Text>
      <Field
        value={form.description}
        onChangeText={(v) => set('description', v)}
        multiline
        textAlignVertical="top"
        className="mb-3 min-h-[80px]"
        placeholder="What your business does, in a sentence or two."
      />

      <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">Services you offer *</Text>
      <Field
        value={form.services}
        onChangeText={(v) => set('services', v)}
        multiline
        textAlignVertical="top"
        className="mb-3 min-h-[64px]"
        placeholder="Comma-separated is fine."
      />

      {/* Target keywords + AI suggestions */}
      <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">Target keywords *</Text>
      <View className="mb-2 flex-row gap-2">
        <View className="flex-1">
          <Field
            value={keywordInput}
            onChangeText={setKeywordInput}
            placeholder="e.g. best bakery in Kolkata"
            onSubmitEditing={addKeyword}
            returnKeyType="done"
          />
        </View>
        <Pressable
          onPress={addKeyword}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.card,
            paddingHorizontal: 16,
          }}
        >
          <Ionicons name="add" size={20} color={t.text} />
        </Pressable>
      </View>
      {form.keywords.length > 0 && (
        <View className="mb-2 flex-row flex-wrap gap-2">
          {form.keywords.map((k) => (
            <Chip
              key={k}
              label={`${k} ×`}
              selected
              onPress={() => set('keywords', form.keywords.filter((x) => x !== k))}
            />
          ))}
        </View>
      )}
      <Pressable
        onPress={() => form.category.trim() && suggest.mutate()}
        disabled={!form.category.trim() || suggest.isPending}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, opacity: form.category.trim() ? 1 : 0.5 }}
      >
        {suggest.isPending ? (
          <ActivityIndicator size="small" color={t.brandBright} />
        ) : (
          <Ionicons name="sparkles-outline" size={14} color={t.brandBright} />
        )}
        <Text className="font-sans-semibold text-xs text-brand-bright">
          {suggest.isPending ? 'Finding keywords…' : 'Suggest keywords for me'}
        </Text>
      </Pressable>
      {suggested.length > 0 && (
        <View className="mb-3 mt-1 flex-row flex-wrap gap-2">
          {suggested.map((k) => (
            <Chip
              key={k}
              label={`+ ${k}`}
              selected={false}
              onPress={() => {
                set('keywords', [...form.keywords, k]);
                setSuggested((s) => s.filter((x) => x !== k));
              }}
            />
          ))}
        </View>
      )}

      <View className="mt-1">
        <LabeledField
          label="Current offers / promotions"
          value={form.offers}
          onChangeText={(v) => set('offers', v)}
          placeholder="Optional — used in promo posts."
        />
        <LabeledField label="City" value={form.city} onChangeText={(v) => set('city', v)} />
        <LabeledField label="Area / locality" value={form.area} onChangeText={(v) => set('area', v)} />
        <LabeledField
          label="Who are your customers?"
          value={form.targetAudience}
          onChangeText={(v) => set('targetAudience', v)}
          placeholder="Your target audience."
        />
      </View>

      <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">What makes you better than competitors?</Text>
      <Field
        value={form.uniqueSellingPoints}
        onChangeText={(v) => set('uniqueSellingPoints', v)}
        multiline
        textAlignVertical="top"
        className="mb-3 min-h-[64px]"
      />

      <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">Main competitors</Text>
      <View className="mb-2 flex-row gap-2">
        <View className="flex-1">
          <Field
            value={competitorInput}
            onChangeText={setCompetitorInput}
            placeholder="Add a competitor's name"
            onSubmitEditing={addCompetitor}
            returnKeyType="done"
          />
        </View>
        <Pressable
          onPress={addCompetitor}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.card,
            paddingHorizontal: 16,
          }}
        >
          <Ionicons name="add" size={20} color={t.text} />
        </Pressable>
      </View>
      {form.competitorNames.length > 0 && (
        <View className="mb-3 flex-row flex-wrap gap-2">
          {form.competitorNames.map((c) => (
            <Chip
              key={c}
              label={`${c} ×`}
              selected
              onPress={() => set('competitorNames', form.competitorNames.filter((x) => x !== c))}
            />
          ))}
        </View>
      )}

      <Text className="mb-2 px-1 font-sans-semibold text-xs text-zinc-400">Primary goal</Text>
      <View className="mb-3 flex-row flex-wrap gap-2">
        {GOALS.map((g) => (
          <Chip
            key={g.id}
            label={g.label}
            selected={form.primaryGoal === g.id}
            onPress={() => set('primaryGoal', form.primaryGoal === g.id ? '' : g.id)}
          />
        ))}
      </View>

      <Text className="mb-2 px-1 font-sans-semibold text-xs text-zinc-400">Content tone</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {TONES.map((tone) => (
          <Chip
            key={tone.id}
            label={tone.label}
            selected={form.tone === tone.id}
            onPress={() => set('tone', tone.id)}
          />
        ))}
      </View>

      <ErrorText>{error}</ErrorText>

      <View className="mt-2">
        <PrimaryButton title="Save & continue" onPress={submit} loading={save.isPending} />
      </View>
    </ScrollView>
  );
}
