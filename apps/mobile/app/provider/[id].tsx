import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useFavouriteFromProfile, usePublicProvider } from '@/api/warranty';
import { palette, radius, spacing } from '@/theme';
import { Badge, Card, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

/**
 * The professional, before you book them.
 *
 * Until this screen existed a customer comparing four offers could see the prices and almost
 * nothing else, which made the marketplace an auction - and PRODUCT_SPEC section 10 is explicit
 * that it should not be one. What is here is what somebody would want to know about a stranger
 * coming to their home: are they verified, have they done this before, what did other people say.
 *
 * What is deliberately *not* here: a phone number, an address, an identity document, or an exact
 * location. Those belong to the professional.
 */
export default function ProviderProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const provider = usePublicProvider(id);
  const favourite = useFavouriteFromProfile(id);

  const maxBar = Math.max(1, ...(provider.data?.ratingBreakdown.map((b) => b.count) ?? [1]));

  return (
    <Screen refreshing={provider.isRefetching} onRefresh={() => void provider.refetch()}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold" style={{ flex: 1 }}>
          Professional
        </Text>
        {provider.data ? (
          <Pressable
            onPress={() => favourite.mutate(provider.data.isFavourite)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={provider.data.isFavourite ? 'Remove from saved' : 'Save this professional'}
          >
            <Ionicons
              name={provider.data.isFavourite ? 'heart' : 'heart-outline'}
              size={22}
              color={provider.data.isFavourite ? palette.danger : palette.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
      <Spacer h={spacing.lg} />

      {provider.isPending ? (
        <Card style={{ gap: spacing.md }}>
          <Skeleton height={28} width="60%" />
          <Skeleton height={80} />
        </Card>
      ) : provider.isError ? (
        <ErrorState title="Could not load this profile" body="Check your connection and try again." onRetry={() => void provider.refetch()} />
      ) : (
        <>
          <Card style={styles.hero}>
            <View style={styles.identity}>
              <View style={styles.avatar}>
                <Text weight="extrabold" style={{ color: palette.primary, fontSize: 22 }}>
                  {provider.data.businessName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" weight="bold">
                  {provider.data.businessName}
                </Text>
                {provider.data.contactName ? (
                  <Text variant="micro" tone="muted">
                    {provider.data.contactName}
                  </Text>
                ) : null}
                <View style={styles.badges}>
                  {provider.data.verificationStatus === 'VERIFIED' ? (
                    <Badge tone="success" icon="shield-checkmark" label="verified" />
                  ) : (
                    <Badge tone="neutral" label="not verified yet" />
                  )}
                  {provider.data.approxDistanceKm !== null ? (
                    <Badge tone="neutral" label={`about ${provider.data.approxDistanceKm} km away`} />
                  ) : null}
                </View>
              </View>
            </View>

            <View style={styles.stats}>
              <Stat value={provider.data.ratingCount > 0 ? provider.data.ratingAvg.toFixed(1) : '—'} label="rating" />
              <Stat value={String(provider.data.completedJobs)} label="jobs done" />
              <Stat
                value={provider.data.experienceYears ? `${provider.data.experienceYears}y` : '—'}
                label="experience"
              />
            </View>
          </Card>

          {provider.data.bio ? (
            <>
              <Spacer h={spacing.md} />
              <Card>
                <Text variant="caption" tone="secondary">
                  {provider.data.bio}
                </Text>
              </Card>
            </>
          ) : null}

          {provider.data.skills.length > 0 ? (
            <>
              <Text weight="semibold" style={styles.section}>
                What they do
              </Text>
              <View style={styles.chips}>
                {provider.data.skills.map((s) => (
                  <View key={s} style={styles.chip}>
                    <Text variant="micro" weight="semibold" style={{ color: palette.primaryDeep }}>
                      {s}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <Text weight="semibold" style={styles.section}>
            Ratings
          </Text>
          {provider.data.ratingCount === 0 ? (
            <Card>
              <Text variant="caption" tone="muted">
                Nobody has rated them yet. That is not a bad sign - everybody starts here.
              </Text>
            </Card>
          ) : (
            <Card style={{ gap: spacing.sm }}>
              {/* A 4.6 from three people is not a 4.6 from three hundred, and only the breakdown
                  shows that honestly. */}
              {provider.data.ratingBreakdown.map((b) => (
                <View key={b.stars} style={styles.barRow}>
                  <Text variant="micro" tone="muted" style={{ width: 14 }}>
                    {b.stars}
                  </Text>
                  <Ionicons name="star" size={11} color="#E8B93B" />
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${Math.round((b.count / maxBar) * 100)}%` }]} />
                  </View>
                  <Text variant="micro" tone="muted" style={{ width: 22, textAlign: 'right' }}>
                    {b.count}
                  </Text>
                </View>
              ))}
            </Card>
          )}

          {provider.data.reviews.length > 0 ? (
            <>
              <Text weight="semibold" style={styles.section}>
                What people said
              </Text>
              <View style={styles.list}>
                {provider.data.reviews.map((r, i) => (
                  <Animated.View key={r.id} entering={FadeInDown.delay(Math.min(i, 6) * 40).duration(300)}>
                    <Card style={{ gap: 4 }}>
                      <View style={styles.reviewHead}>
                        <View style={styles.starRow}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Ionicons key={n} name={n <= r.rating ? 'star' : 'star-outline'} size={12} color="#E8B93B" />
                          ))}
                        </View>
                        <Text variant="micro" tone="muted" style={{ flex: 1 }}>
                          {r.reviewerName}
                        </Text>
                        <Text variant="micro" tone="muted">
                          {new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </Text>
                      </View>
                      {r.comment ? (
                        <Text variant="caption" tone="secondary">
                          {r.comment}
                        </Text>
                      ) : null}
                    </Card>
                  </Animated.View>
                ))}
              </View>
            </>
          ) : null}

          <Spacer h={spacing.md} />
          <Text variant="micro" tone="muted" center>
            On the platform since{' '}
            {new Date(provider.data.memberSince).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </Text>
        </>
      )}
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="label" weight="bold">
        {value}
      </Text>
      <Text variant="micro" tone="muted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hero: { gap: spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F6F1' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  stats: { flexDirection: 'row', gap: spacing.md, backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  section: { fontSize: 14, marginTop: spacing.lg, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: '#E8F6F1' },
  list: { gap: spacing.sm },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  starRow: { flexDirection: 'row', gap: 1 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#EEF4F2', overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: palette.primary },
});
