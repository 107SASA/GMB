import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { quickAddCustomer } from '@/api/endpoints/customers';
import { useBusiness } from '@/business/BusinessContext';
import { ContactPickerModal } from '@/components/contact-picker-modal';
import { ReviewQrModal } from '@/components/review-qr-modal';
import { Field, PrimaryButton, useInfoSheet } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * Phone input + "Add Customer" — the intended flow: enter a customer's
 * number, the app immediately sends them a WhatsApp review request (same
 * one-off send the "Send Review Request" button on the website's Customers
 * page uses, via POST /api/customers/quick-add → the processReviewCampaign
 * Inngest job). This used to call the CRM lead endpoint instead, which only
 * filed a sales-pipeline contact and queued a generic 24h-later "thanks for
 * your interest" WhatsApp drip — no review request was ever sent.
 *
 * Originally private to dashboard.tsx (Home tab); extracted here (Aug 2026)
 * so the Reviews tab's "Add more customers to increase potential reviews"
 * card can reuse the exact same flow instead of rebuilding it.
 */
export function AddCustomerCard() {
  const t = useTheme();
  const { activeBusiness } = useBusiness();
  const [phone, setPhone] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const info = useInfoSheet();

  const add = useMutation({
    mutationFn: () => quickAddCustomer({ phone: phone.trim() }),
    onSuccess: (result) => {
      setPhone('');
      if (!result.reviewRequestSent) {
        info.show('Customer saved', result.reason ?? 'No review request was sent.');
        return;
      }
      info.show(
        'Review request sent',
        result.existing
          ? `${result.customer.name} was already a customer — sent them another WhatsApp review request.`
          : `We've texted ${result.customer.name} on WhatsApp asking for a Google review.`
      );
    },
    onError: (error) =>
      info.show('Could not add customer', getApiErrorMessage(error, 'Please try again.')),
  });

  return (
    <View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field
            value={phone}
            onChangeText={setPhone}
            placeholder="Customer Phone Number"
            keyboardType="phone-pad"
          />
        </View>
        <Pressable
          onPress={() => setPickerOpen(true)}
          // No `className` — see app-header.tsx note.
          style={{
            height: 52,
            width: 52,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.card,
          }}
        >
          <Ionicons name="people-outline" size={22} color={t.brandBright} />
        </Pressable>
        <Pressable
          onPress={() => setQrOpen(true)}
          accessibilityLabel="Share Google review QR code"
          // No `className` — see app-header.tsx note.
          style={{
            height: 52,
            width: 52,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.card,
          }}
        >
          <Ionicons name="qr-code-outline" size={22} color={t.brandBright} />
        </Pressable>
      </View>
      <View className="mt-3">
        <PrimaryButton
          title="Send Review Link"
          onPress={() => add.mutate()}
          loading={add.isPending}
          disabled={phone.trim().length < 7}
        />
      </View>

      <ContactPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(contact) => {
          setPhone(contact.phone);
          setPickerOpen(false);
        }}
      />
      <ReviewQrModal
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        businessName={activeBusiness?.name ?? 'your business'}
        placeId={activeBusiness?.googlePlaceId ?? activeBusiness?.placeId}
      />
      {info.node}
    </View>
  );
}
