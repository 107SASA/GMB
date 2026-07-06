import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCallback, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';

/**
 * Imperative date+time picking shared by the content and scheduler screens.
 *
 * Android has no combined datetime mode, so it chains the native date dialog
 * into the time dialog. iOS shows a single spinner inside a bottom sheet.
 * Render `{element}` once in the screen; call `open(initial, onPick)`.
 */
export function useDateTimePicker() {
  const [state, setState] = useState<{
    value: Date;
    step: 'date' | 'time';
    onPick: (date: Date) => void;
  } | null>(null);

  const open = useCallback((initial: Date, onPick: (date: Date) => void) => {
    setState({ value: initial, step: 'date', onPick });
  }, []);

  const handleAndroidChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (!state) return;
    if (event.type === 'dismissed' || !selected) {
      setState(null);
      return;
    }
    if (state.step === 'date') {
      setState({ ...state, value: selected, step: 'time' });
    } else {
      setState(null);
      state.onPick(selected);
    }
  };

  let element: React.ReactNode = null;
  if (state && Platform.OS === 'android') {
    element = (
      <DateTimePicker
        value={state.value}
        mode={state.step}
        minimumDate={state.step === 'date' ? new Date() : undefined}
        onChange={handleAndroidChange}
      />
    );
  } else if (state) {
    element = (
      <Modal transparent animationType="slide" onRequestClose={() => setState(null)}>
        <View className="flex-1 justify-end bg-black/60">
          <View className="rounded-t-2xl border-t border-surface-border bg-surface-raised pb-8">
            <View className="flex-row items-center justify-between px-5 py-3">
              <Pressable onPress={() => setState(null)}>
                <Text className="text-base text-zinc-400">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const picked = state.value;
                  const onPick = state.onPick;
                  setState(null);
                  onPick(picked);
                }}
              >
                <Text className="text-base font-semibold text-indigo-300">Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={state.value}
              mode="datetime"
              display="spinner"
              minimumDate={new Date()}
              themeVariant="dark"
              onChange={(_, selected) => {
                if (selected) setState((s) => (s ? { ...s, value: selected } : s));
              }}
            />
          </View>
        </View>
      </Modal>
    );
  }

  return { open, element };
}
