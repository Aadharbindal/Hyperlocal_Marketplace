import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useAddresses, useDeleteAddress } from '@/api/jobs';
import { palette, spacing } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

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
 * It used to hold the form as well. It does not any more: adding and editing both go to the map
 * picker, because a typed address is a geocoder's guess at where somebody lives and a dropped pin
 * is not. The list stays here - this is the screen for seeing what you have and removing one.
 */
export default function AddressesScreen() {
  const router = useRouter();
  const addresses = useAddresses();
  const remove = useDeleteAddress();
  const [error, setError] = useState<string | null>(null);

  /**
   * Removing an address.
   *
   * Confirmed, because it is the one thing on this screen that cannot be undone by tapping
   * again. The server soft-deletes, so bookings that already happened keep the address they
   * were actually carried out at - which is why the warning says "future bookings".
   */
  function confirmRemove(id: string, name: string) {
    Alert.alert(
      'Remove this address?',
      `${name} will no longer be offered for new bookings. Bookings already completed keep it on their receipt.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setError(null);
            void remove.mutateAsync(id).catch(() => setError('That did not delete. Please try again.'));
          },
        },
      ],
    );
  }

  return (
    <Screen refreshing={addresses.isRefetching} onRefresh={() => void addresses.refetch()}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold" style={styles.flex}>
          Your addresses
        </Text>
      </View>
      <Spacer h={spacing.lg} />

      {addresses.isPending ? (
        <View style={styles.list}>
          <Skeleton height={76} />
          <Skeleton height={76} />
        </View>
      ) : addresses.isError ? (
        /* A failed load used to fall through to "No address yet", which tells somebody who has
           three saved addresses that they have none - and the obvious response is to add a fourth.
           An empty state standing in for a network failure is a lie the screen tells confidently. */
        <ErrorState
          title="We could not load your addresses"
          body="They are still saved. Check your connection and try again."
          onRetry={() => void addresses.refetch()}
          retrying={addresses.isRefetching}
        />
      ) : addresses.data?.items.length ? (
        <View style={styles.list}>
          {addresses.data.items.map((a, i) => (
            <Animated.View key={a.id} entering={FadeInDown.delay(Math.min(i, 5) * 50).duration(300)}>
              <Card
                padding="md"
                style={styles.row}
                onPress={() => router.push({ pathname: '/address-picker', params: { id: a.id } })}
                accessibilityLabel={`Edit ${a.label ?? 'address'}, ${a.line1}, ${a.city}`}
              >
                <Ionicons name="location" size={20} color={palette.primary} />
                <View style={styles.rowText}>
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
                <Pressable
                  onPress={() => confirmRemove(a.id, a.label ?? a.line1)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${a.label ?? a.line1}`}
                  style={styles.removeBtn}
                >
                  <Ionicons name="trash-outline" size={18} color={palette.danger} />
                </Pressable>
              </Card>
            </Animated.View>
          ))}
        </View>
      ) : (
        <EmptyState
          icon="home-outline"
          title="No address yet"
          body="Add the place the work is needed. A professional has to know where to come."
          actionLabel="Add an address"
          onAction={() => router.push('/address-picker')}
        />
      )}

      {error ? (
        <>
          <Spacer h={spacing.md} />
          <Text variant="caption" tone="danger">
            {error}
          </Text>
        </>
      ) : null}

      {addresses.data?.items.length ? (
        <>
          <Spacer h={spacing.xl} />
          <Button title="Add an address" fullWidth icon="add" variant="secondary" onPress={() => router.push('/address-picker')} />
        </>
      ) : null}

      <Spacer h={spacing.lg} />
      <Text variant="micro" tone="muted">
        Tap an address to move its pin or change the details. We only show the full address to the
        professional who is actually coming, and only once the booking is confirmed.
      </Text>
      <Spacer h={spacing.xxl} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  list: { gap: spacing.sm },
  removeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
});
