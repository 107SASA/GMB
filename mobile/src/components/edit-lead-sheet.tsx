import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { updateLead, type Lead } from '@/api/endpoints/leads';
import { EventPicker } from '@/components/event-picker';
import { BottomSheet, ErrorText, Field, PrimaryButton } from '@/components/ui';
import { parsePhoneCandidate } from '@/lib/phone';
import { useTheme } from '@/lib/theme';

/**
 * "Edit lead" — contact and visiting-card details. Cards saved automatically
 * (no confirmation) are fixed here; saving clears their "Check details" flag.
 * A phone / email that belongs to another lead is refused by the server.
 */

type Draft = {
  name: string;
  phone: string;
  email: string;
  company: string;
  designation: string;
  website: string;
  address: string;
  city: string;
  metAt: string;
};

function draftFrom(lead: Lead): Draft {
  const c = lead.businessCard ?? {};
  return {
    name: lead.name ?? '',
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    company: c.company ?? '',
    designation: c.designation ?? '',
    website: c.website ?? '',
    address: c.address ?? '',
    city: lead.city ?? '',
    metAt: c.metAt ?? '',
  };
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text className="font-sans-semibold text-xs uppercase tracking-wider text-zinc-500">{label}</Text>
      {children}
    </View>
  );
}

export function EditLeadSheet({
  visible,
  lead,
  businessId,
  onClose,
}: {
  visible: boolean;
  lead: Lead;
  businessId: string | null;
  onClose: () => void;
}) {
  const t = useTheme();
  const queryClient = useQueryClient();
  const [d, setD] = useState<Draft>(() => draftFrom(lead));
  const isCard = !!lead.businessCard || lead.source === 'Business Card';
  // A WhatsApp lead's chat is tied to its number — changing it here would cut that link.
  const phoneLocked = lead.source === 'WhatsApp' && !!lead.phone;

  useEffect(() => {
    if (visible) setD(draftFrom(lead));
    // Re-seed only when the sheet opens, not on every background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const set = (k: keyof Draft) => (v: string) => setD((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      updateLead(lead._id, {
        name: d.name.trim() || lead.name,
        ...(phoneLocked ? {} : { phone: d.phone.trim() }),
        email: d.email.trim(),
        city: d.city.trim(),
        ...(isCard
          ? {
              businessCard: {
                company: d.company.trim(),
                designation: d.designation.trim(),
                website: d.website.trim(),
                address: d.address.trim(),
                metAt: d.metAt.trim(),
                // The owner has now checked this lead.
                needsReview: false,
              },
            }
          : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-leads', businessId] });
      void queryClient.invalidateQueries({ queryKey: ['card-events', businessId] });
      onClose();
    },
  });

  const phoneValid = !d.phone.trim() || parsePhoneCandidate(d.phone) !== null;
  const emailValid = !d.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim());
  const hasContact = !!(d.name.trim() || d.phone.trim() || d.email.trim());

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text className="font-display-bold text-lg" style={{ color: t.text }}>Edit lead</Text>
      <View style={{ marginTop: 14, gap: 12 }}>
        <Labeled label="Name">
          <Field value={d.name} onChangeText={set('name')} placeholder="Full name" autoCapitalize="words" />
        </Labeled>
        <Labeled label="Phone">
          <Field value={d.phone} onChangeText={set('phone')} placeholder="+91 98765 43210" keyboardType="phone-pad" editable={!phoneLocked} />
          {phoneLocked && <Text className="font-sans text-xs text-zinc-500">This number is linked to the WhatsApp chat, so it can't be changed.</Text>}
          {!phoneValid && <Text className="font-sans text-xs text-zinc-500">Enter a 10-digit number or use +country format.</Text>}
        </Labeled>
        <Labeled label="Email">
          <Field value={d.email} onChangeText={set('email')} placeholder="name@company.com" keyboardType="email-address" autoCapitalize="none" />
          {!emailValid && <Text className="font-sans text-xs text-zinc-500">The email address looks wrong.</Text>}
        </Labeled>
        {isCard && (
          <>
            <Labeled label="Company">
              <Field value={d.company} onChangeText={set('company')} placeholder="Company" />
            </Labeled>
            <Labeled label="Job title">
              <Field value={d.designation} onChangeText={set('designation')} placeholder="e.g. Sales Manager" />
            </Labeled>
            <Labeled label="Website">
              <Field value={d.website} onChangeText={set('website')} placeholder="www.company.com" autoCapitalize="none" keyboardType="url" />
            </Labeled>
            <Labeled label="Address">
              <Field value={d.address} onChangeText={set('address')} placeholder="Address" multiline className="min-h-16" textAlignVertical="top" />
            </Labeled>
          </>
        )}
        <Labeled label="City">
          <Field value={d.city} onChangeText={set('city')} placeholder="City" />
        </Labeled>
        {isCard && (
          <Labeled label="Where you met">
            <EventPicker businessId={businessId} value={d.metAt} onChange={set('metAt')} />
          </Labeled>
        )}

        <ErrorText>{save.error ? getApiErrorMessage(save.error, 'Could not save the changes.') : null}</ErrorText>
        <PrimaryButton
          title="Save changes"
          loading={save.isPending}
          disabled={!phoneValid || !emailValid || !hasContact}
          onPress={() => save.mutate()}
        />
        <Pressable onPress={onClose} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }}>Cancel</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
