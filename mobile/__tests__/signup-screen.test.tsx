import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text, TextInput, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import SignupScreen from '@/app/(auth)/signup';

// The free-account sign-up: name → business (Google search, or typed) →
// WhatsApp number → code. Same steps and calls as before the redesign; this
// covers the flow and that both the light and dark looks render.

const mockRequestSignupOtp = jest.fn(async () => ({ maskedPhone: '+91 ••••• •3210', existingAccount: false }));
const mockSignUp = jest.fn(async () => {});
const mockReplace = jest.fn();

jest.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ requestSignupOtp: mockRequestSignupOtp, signUp: mockSignUp }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, back: jest.fn(), push: jest.fn() }) }));
jest.mock('@/components/onboarding/StepBusinessSearch', () => {
  const { Pressable, Text: T } = require('react-native');
  return {
    StepBusinessSearch: ({ onSelected }: { onSelected: (id: string, d: unknown) => void }) => (
      <Pressable
        onPress={() => onSelected('ChIJtest123', { name: 'Shree Dental', city: 'Pune', primaryCategory: 'Dentist', formattedAddress: 'FC Road, Pune' })}
      >
        <T>Pick sample business</T>
      </Pressable>
    ),
  };
});
jest.mock('@/components/phone-number-field', () => {
  const { TextInput: TI } = require('react-native');
  return {
    PhoneNumberField: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
      <TI testID="phone" value={value} onChangeText={(v: string) => onChange(`+91${v}`)} />
    ),
  };
});
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: jest.fn(() => 'light') }));

function wrap(ui: ReactNode) {
  const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

const PURCHASE = /(₹|\$|price|pricing|buy|purchase|upgrade|subscribe|checkout|credit card)/i;

beforeEach(() => {
  jest.clearAllMocks();
  (useColorScheme as jest.Mock).mockReturnValue('light');
});

describe('Sign-up screen', () => {
  it('walks name → Google business → WhatsApp → code and creates the account', async () => {
    wrap(<SignupScreen />);
    expect(screen.getByText("What's your name?")).toBeTruthy();
    expect(screen.getByText('STEP 1 OF 3')).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('e.g. Rahul Sharma'), 'Rahul Sharma');
    fireEvent.press(screen.getByText('Continue'));

    expect(screen.getByText('Find your business')).toBeTruthy();
    expect(screen.getByText('Google Maps Directory')).toBeTruthy();
    fireEvent.press(screen.getByText('Pick sample business'));
    expect(screen.getByText('Shree Dental')).toBeTruthy();
    fireEvent.press(screen.getByText('Continue'));

    expect(screen.getByText('Your WhatsApp Number')).toBeTruthy();
    expect(screen.getByText('STEP 3 OF 3')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('phone'), '9876543210');
    await act(async () => {
      fireEvent.press(screen.getByText('Send code on WhatsApp'));
    });
    expect(mockRequestSignupOtp).toHaveBeenCalledWith('+919876543210');

    await waitFor(() => expect(screen.getByText('Enter the code')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('6-digit code'), '123456');
    await act(async () => {
      fireEvent.press(screen.getByText('Create my free account'));
    });
    expect(mockSignUp).toHaveBeenCalledWith({
      phone: '+919876543210',
      otp: '123456',
      name: 'Rahul Sharma',
      business: { googlePlaceId: 'ChIJtest123', name: 'Shree Dental', city: 'Pune', category: 'Dentist' },
    });
  });

  it('"Skip for now" lets a business not on Google type its details', async () => {
    wrap(<SignupScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Rahul Sharma'), 'Asha');
    fireEvent.press(screen.getByText('Continue'));
    fireEvent.press(screen.getByText('Skip for now'));

    expect(screen.getByText(/BUSINESS NAME/)).toBeTruthy();
    expect(screen.getAllByText('Optional')).toHaveLength(2);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Shree Dental Clinic'), 'Asha Salon');
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Pune, Maharashtra'), 'Nashik');
    fireEvent.press(screen.getByText('Continue'));
    expect(screen.getByText('Your WhatsApp Number')).toBeTruthy();

    // The Google card goes back to the search.
    fireEvent.press(screen.getByLabelText('Back'));
    fireEvent.press(screen.getByLabelText('Find my business on Google Maps'));
    expect(screen.getByText('Find your business')).toBeTruthy();
  });

  it('Continue stays off until a name is typed', () => {
    wrap(<SignupScreen />);
    fireEvent.press(screen.getByText('Continue'));
    expect(screen.queryByText('Find your business')).toBeNull();
  });

  it.each(['light', 'dark'] as const)('renders every step in %s mode without purchase wording', (scheme) => {
    (useColorScheme as jest.Mock).mockReturnValue(scheme);
    wrap(<SignupScreen />);
    const texts: string[] = [];
    const collect = () => texts.push(JSON.stringify(screen.toJSON()));
    collect();
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Rahul Sharma'), 'Rahul');
    fireEvent.press(screen.getByText('Continue'));
    collect();
    fireEvent.press(screen.getByText('Skip for now'));
    collect();
    expect(texts.join(' ')).not.toMatch(PURCHASE);
    expect(screen.getByText('Sign in')).toBeTruthy();
  });

  it('"Sign in" goes to the login screen', () => {
    wrap(<SignupScreen />);
    fireEvent.press(screen.getByText('Sign in'));
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });
});

// Keep the imports used by the mocks above referenced for TypeScript.
void Text;
void TextInput;
