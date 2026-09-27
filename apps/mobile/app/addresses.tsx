import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ApiError } from '@/api/client';
import { useAddresses, useCreateAddress } from '@/api/jobs';
import { palette, radius, spacing, typography } from '@/theme';
import { Badge, Button, Card, EmptyState, Screen, Skeleton, Spacer, Text } from '@/ui';

/**
 * Where the work happens.
 *
 * This screen did not exist, and its absence was a wall across the middle of the product. A new
 * customer could sign in, choose plumbing, describe their leaking tap - and then reach a booking
 * form whose "Where?" section said *"Add an address in your profile to continue"* and a profile
 * that had no such thing. The API had always accepted addresses and the booking form had always
 * listed them; nobody could create one. Found by walking the app on a phone as a first-time user,
 * which is the only way it could have been found.
 *
 * Deliberately short. Somebody is here because they were interrupted mid-booking, so it asks for
 * the four things the job actually needs - the line, a landmark, the city, the PIN - and sends
 * them straight back.
 */
export default function AddressesScreen() {
  const router = useRouter();
  const addresses = useAddresses();
  const create = useCreateAddress();

  const [label, setLabel] = useState('Home');
  const [line1, setLine1] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('Delhi');
  const [pincode, setPincode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const complete = line1.trim().length >= 3 && city.trim().length >= 2 && /^\d{6}$/.test(pincode);

  async function save() {
    setError(null);
    try {
      await create.mutateAsync({
        label: label.trim() || 'Home',
        line1: line1.trim(),
        city: city.trim(),
        pincode: pincode.trim(),
        ...(landmark.trim() ? { landmark: landmark.trim() } : {}),
      });
      setLine1('');
      setLandmark('');
      setPincode('');
      // Straight back to whatever they were doing, which is almost always a half-finished booking.
      if (router.canGoBack()) router.back();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.code === 'VALIDATION_ERROR'
            ? 'Check the address and PIN code.'
            : 'That did not save. Please try again.'
          : 'That did not save. Please try again.',
      );
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold" style={{ flex: 1 }}>
          Your addresses
        </Text>
      </View>
      <Spacer h={spacing.lg} />

      {addresses.isPending ? (
        <View style={styles.list}>
          <Skeleton height={76} />
          <Skeleton height={76} />
        </View>
      ) : addresses.data?.items.length ? (
        <View style={styles.list}>
          {addresses.data.items.map((a, i) => (
            <Animated.View key={a.id} entering={FadeInDown.delay(Math.min(i, 5) * 50).duration(300)}>
              <Card padding="md" style={styles.row}>
                <Ionicons name="location" size={20} color={palette.primary} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" weight="semibold">
                    {a.label}
                  </Text>
                  <Text variant="caption" tone="secondary" numberOfLines={2}>
                    {a.line1}, {a.city} {a.pincode}
                  </Text>
                </View>
                {/* Said here as well as on the booking form, because finding out an address is
                    unusable at the moment of booking is the annoying version. */}
                {!a.inPilotZone ? <Badge tone="warning" label="Outside zone" /> : a.isDefault ? <Badge tone="primary" label="default" /> : null}
              </Card>
            </Animated.View>
          ))}
        </View>
      ) : (
        <EmptyState
          icon="home-outline"
          title="No address yet"
          body="Add the place the work is needed. A professional has to know where to come."
        />
      )}

      <Spacer h={spacing.xl} />
      <Text variant="heading" weight="bold">
        Add an address
      </Text>
      <Spacer h={spacing.sm} />

      <Card padding="lg" style={{ gap: spacing.md }}>
        <Field label="Name it" value={label} onChange={setLabel} placeholder="Home" autoCapitalize="words" />
        <Field
          label="Flat, building and street"
          value={line1}
          onChange={setLine1}
          placeholder="12, Lodhi Colony"
          autoCapitalize="words"
        />
        <Field label="Landmark (optional)" value={landmark} onChange={setLandmark} placeholder="Opposite the park gate" />
        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Field label="City" value={city} onChange={setCity} placeholder="Delhi" autoCapitalize="words" />
          </View>
          <View style={{ width: 130 }}>
            <Field label="PIN code" value={pincode} onChange={setPincode} placeholder="110003" keyboardType="number-pad" maxLength={6} />
          </View>
        </View>

        {error ? (
          <Text variant="caption" tone="danger">
            {error}
          </Text>
        ) : null}

        <Button
          title="Save address"
          fullWidth
          icon="checkmark"
          disabled={!complete}
          loading={create.isPending}
          onPress={() => void save()}
        />
        <Text variant="micro" tone="muted">
          We only show the full address to the professional who is actually coming, and only once
          the booking is confirmed.
        </Text>
      </Card>
      <Spacer h={spacing.xxl} />
    </Screen>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  maxLength,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  keyboardType?: 'number-pad';
  maxLength?: number;
  autoCapitalize?: 'words';
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pair: { flexDirection: 'row', gap: spacing.md },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    fontFamily: typography.family.medium,
    fontSize: typography.size.body,
    color: palette.text,
  },
});
