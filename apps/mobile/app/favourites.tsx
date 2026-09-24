import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { FavouriteProviderView } from '@hyperlocal/core';
import { useFavourites, useRebook, useToggleFavourite } from '@/api/growth';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

/**
 * Professionals somebody wants again.
 *
 * "Book again" opens a new job rather than assigning anyone: the preferred professional is told
 * about it first, and the customer still sees every offer. Quietly assigning somebody would take
 * away the comparison, which is the thing a marketplace is for.
 */
export default function FavouritesScreen() {
  const router = useRouter();
  const favourites = useFavourites();
  const toggle = useToggleFavourite();
  const rebook = useRebook();
  const [busy, setBusy] = useState<string | null>(null);

  async function bookAgain(f: FavouriteProviderView) {
    // The server already knows which job is worth repeating; the client does not go looking.
    if (!f.lastJobId) return;
    setBusy(f.providerId);
    try {
      const { job } = await rebook.mutateAsync({ jobId: f.lastJobId, preferProviderId: f.providerId });
      router.push(`/(customer)/job/${job.id}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen refreshing={favourites.isRefetching} onRefresh={() => void favourites.refetch()}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold">
          Saved professionals
        </Text>
      </View>
      <Spacer h={spacing.lg} />

      {favourites.isPending ? (
        <View style={styles.list}>
          <Skeleton height={92} />
          <Skeleton height={92} />
        </View>
      ) : favourites.isError ? (
        <ErrorState title="Could not load your list" body="Check your connection and try again." onRetry={() => void favourites.refetch()} />
      ) : favourites.data.length === 0 ? (
        <EmptyState
          icon="heart-outline"
          title="Nobody saved yet"
          body="After a job is done, save the professional if you would have them back. They will be the first to hear about your next booking."
        />
      ) : (
        <View style={styles.list}>
          {favourites.data.map((f, i) => (
            <Animated.View key={f.providerId} entering={FadeInDown.delay(Math.min(i, 6) * 50).duration(320)}>
              <Card style={styles.card}>
                <View style={styles.row}>
                  <View style={styles.avatar}>
                    <Text weight="bold" style={{ color: palette.primary }}>
                      {f.businessName.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="label" weight="bold">
                      {f.businessName}
                    </Text>
                    <Text variant="micro" tone="muted">
                      {f.ratingCount > 0 ? `${f.ratingAvg.toFixed(1)} · ${f.ratingCount} ratings` : 'No ratings yet'}
                      {f.jobsTogether > 0 ? ` · ${f.jobsTogether} ${f.jobsTogether === 1 ? 'job' : 'jobs'} with you` : ''}
                    </Text>
                    {f.categories.length ? (
                      <Text variant="micro" tone="muted">
                        {f.categories.join(', ')}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => toggle.mutate({ providerId: f.providerId, saved: true })}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${f.businessName} from saved`}
                  >
                    <Ionicons name="heart" size={22} color={palette.danger} />
                  </Pressable>
                </View>

                {f.note ? (
                  <Text variant="micro" tone="muted" style={styles.note}>
                    &ldquo;{f.note}&rdquo;
                  </Text>
                ) : null}

                <View style={styles.actions}>
                  {/* Said honestly, so the button never promises something that will fail. */}
                  {f.available ? (
                    <Badge tone="success" label="available now" />
                  ) : (
                    <Badge tone="neutral" label={f.verified ? 'busy right now' : 'not verified'} />
                  )}
                  <View style={{ flex: 1 }} />
                  <Button
                    title="Book again"
                    size="sm"
                    variant="secondary"
                    disabled={!f.lastJobId}
                    loading={busy === f.providerId}
                    onPress={() => void bookAgain(f)}
                  />
                </View>
              </Card>
            </Animated.View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  list: { gap: spacing.sm },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F6F1',
  },
  note: { fontStyle: 'italic' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: '#EEF4F2', paddingTop: spacing.sm },
  chip: { borderRadius: radius.sm },
});
