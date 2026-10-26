/**
 * Renders the REAL PrimaryButton (full NativeWind/css-interop processing —
 * babel.config.js sets jsxImportSource: 'nativewind' globally, so this test
 * goes through the exact same JSX runtime as the Android bundle). No router,
 * no app screens — isolates the disabled(true)->disabled(false) transition
 * (mirrors typing valid credentials) AND an actual press (mirrors tapping
 * Sign in), including the real Haptics.impactAsync call.
 */
import { fireEvent, render } from '@testing-library/react-native';

import { PrimaryButton } from '@/components/ui';

test('PrimaryButton enable + press does not throw', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  let caught: unknown = null;
  const onPress = jest.fn();

  try {
    const { rerender, getByText } = await render(
      <PrimaryButton title="Sign in" onPress={onPress} disabled={true} />
    );
    await rerender(<PrimaryButton title="Sign in" onPress={onPress} disabled={false} />);
    fireEvent.press(getByText('Sign in'));
  } catch (err) {
    caught = err;
  }

  const errorLines = consoleError.mock.calls.map((args) => args.map(String).join(' '));
  consoleError.mockRestore();

  if (caught) {
    console.log('--- Thrown error ---');
    console.log(caught instanceof Error ? caught.stack : String(caught));
  }
  if (errorLines.length) {
    console.log('--- console.error during press ---');
    errorLines.forEach((l: string) => console.log(l));
  }

  console.log('onPress called:', onPress.mock.calls.length, 'times');
  expect(caught).toBeNull();
});
