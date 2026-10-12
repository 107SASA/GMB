import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * First-launch intro slides (app/welcome.tsx) are shown once per install,
 * before sign-in. Not sensitive, so AsyncStorage rather than SecureStore.
 * Bump the key's version to show a changed intro to everyone once more.
 */
const INTRO_SEEN_KEY = 'intro_seen_v1';

export async function hasSeenIntro(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(INTRO_SEEN_KEY)) === '1';
  } catch {
    // Never block sign-in on a storage error: treat the intro as seen.
    return true;
  }
}

export async function markIntroSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    // Worst case the intro shows again next launch.
  }
}
