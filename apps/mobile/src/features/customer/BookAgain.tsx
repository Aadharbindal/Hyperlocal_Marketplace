import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRebook, useRebookable } from '@/api/jobs';
import { palette, radius, spacing } from '@/theme';
import { Card, RealisticIcon, Spacer, Text } from '@/ui';

/**
 * "You had a tap fixed in March. Again?"
 *
 * The app had no memory of anybody. Somebody who had already let a stranger into their home,
 * paid, and been happy came back to the same blank grid of categories as a first-time visitor,
 * and had to describe the same problem in the same words to the same empty box.
 *
 * What it deliberately does not do is re-run the old booking. Tapping this opens a normal draft
 * with the kind of work, the place and last time's description filled in - the price and the
 * professional are not carried over, because a repeat is a new job that has to be quoted on its
 * own, and showing somebody last time's number would be quoting them a price nobody has agreed
 * to. The previous professional's name is shown because it is the reason to come back, not
 * because it is a commitment.
 */
export function BookAgain() {
  const router = useRouter();
  const recent = useRebookable();
  const rebook = useRebook();
  const [busy, setBusy] = useState<string | null>(null);

  const items = recent.data?.items ?? [];
  // No history is the normal state for most of the people opening this app, and an empty
  // "Book again" shelf would be a reminder that they are new.
  if (items.length === 0) return null;

  async function again(jobId: string) {
    // A second tap while the first is still in flight would create a second draft.
    if (busy) return;
    setBusy(jobId);
    try {
      const draft = await rebook.mutateAsync(jobId);
      router.push({ pathname: '/(customer)/book', params: { categoryId: draft.category.id, draftId: draft.id } });
    } catch {
      // Falling back to an ordinary booking is a fine outcome: nothing has been lost, and an
      // error banner over a convenience shortcut helps nobody.
      router.push('/(customer)/book');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Text variant="heading" weight="bold" style={styles.title}>
        Book again
      </Text>
      <Spacer h={spacing.sm} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item, i) => (
          <Animated.View key={item.jobId} entering={FadeInDown.delay(Math.min(i, 4) * 60).duration(320)}>
            <Card
              style={styles.card}
              padding="md"
              onPress={() => void again(item.jobId)}
              accessibilityLabel={`Book ${item.categoryName} again${item.providerName ? `, last done by ${item.providerName}` : ''}`}
            >
              <RealisticIcon iconKey={item.iconKey} size={40} />
              <View style={{ gap: 1 }}>
                <Text variant="label" weight="semibold" numberOfLines={1}>
                  {item.categoryName}
                </Text>
                <Text variant="micro" tone="muted" numberOfLines={1}>
                  {item.providerName ? item.providerName : whenish(item.lastAt)}
                </Text>
              </View>
            </Card>
          </Animated.View>
        ))}
      </ScrollView>
    </>
  );
}

/**
 * "in March", not "on 12 March 2026". Nobody remembers their booking by its date, and a precise
 * one reads like a record being kept on them rather than a convenience.
 */
function whenish(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days < 14) return 'recently';
  if (days < 60) return 'last month';
  return `in ${then.toLocaleDateString('en-IN', { month: 'long' })}`;
}

const styles = StyleSheet.create({
  title: {},
  // `Screen` already applies the horizontal gutter; padding again would inset it twice.
  row: { gap: spacing.sm, paddingVertical: spacing.xs, paddingRight: spacing.lg },
  card: {
    width: 150,
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
  },
});
