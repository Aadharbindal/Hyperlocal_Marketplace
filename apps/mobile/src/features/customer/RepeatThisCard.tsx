import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { describeInterval, type JobStatus, type JobView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useCreateServicePlan, useServicePlans } from '@/api/hooks';
import { palette, radius, spacing } from '@/theme';
import { Button, Card, Text } from '@/ui';

/**
 * Turning a finished job into a standing arrangement.
 *
 * The plans screen shipped able to list, pause, skip and cancel repeats, and with no way to
 * create one - so it managed something a customer could not set up. Found by walking the app on
 * a phone rather than by any test, because every test and the wiring audit only ever saw that
 * the endpoint was *mentioned*.
 *
 * This is the right moment to ask. The customer has just had the work done, they know whether it
 * is the kind of thing that comes back, and everything the plan needs - the category, the
 * address, what they wrote, who did it - is already on the job in front of them. Asking anywhere
 * else would mean asking them to fill it all in again.
 */

/** Offered only once the work is actually finished. */
const FINISHED: JobStatus[] = ['COMPLETED', 'SETTLED'];

/**
 * The intervals people actually mean, in days.
 *
 * Four, not a number picker. "Every 37 days" is not a thing anybody wants for a geyser service,
 * and a free number invites a choice nobody has an opinion about.
 */
const CHOICES = [30, 90, 180, 365];

export function RepeatThisCard({ job }: { job: JobView }) {
  const router = useRouter();
  const create = useCreateServicePlan();
  const plans = useServicePlans();
  const reduced = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [interval, setInterval] = useState(90);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!FINISHED.includes(job.status) || !job.addressId) return null;

  // One live plan per category and address is a database rule (0020). Offering a button that can
  // only produce a conflict is worse than not offering it.
  const already = (plans.data?.items ?? []).some(
    (p) => p.categoryId === job.category.id && p.addressId === job.addressId && p.status !== 'CANCELLED',
  );
  if (already && !done) return null;

  /** The first visit lands one interval from today, which is what "every 3 months" means to somebody. */
  const firstDue = () => {
    const d = new Date();
    d.setDate(d.getDate() + interval);
    return d.toISOString().slice(0, 10);
  };

  async function setUp() {
    setError(null);
    try {
      await create.mutateAsync({
        categoryId: job.category.id,
        addressId: job.addressId!,
        intervalDays: interval,
        firstDueOn: firstDue(),
        ...(job.description ? { description: job.description } : {}),
      });
      setDone(true);
      setOpen(false);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'CONFLICT'
          ? 'You already have a repeat for this service at this address.'
          : e instanceof ApiError
            ? e.message
            : 'Could not set that up right now.',
      );
    }
  }

  if (done) {
    return (
      <Animated.View entering={reduced ? undefined : FadeIn.duration(300)}>
        <Card style={styles.doneCard}>
          <Ionicons name="checkmark-circle" size={20} color={palette.primaryDeep} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" weight="bold">
              {`Set to repeat ${describeInterval(interval)}`}
            </Text>
            <Text variant="micro" tone="muted">
              We will open the next booking when it falls due. Nothing is charged automatically.
            </Text>
          </View>
          <Button title="Manage" size="sm" variant="ghost" onPress={() => router.push('/service-plans')} />
        </Card>
      </Animated.View>
    );
  }

  if (!open) {
    return (
      <Card style={styles.prompt} onPress={() => setOpen(true)} accessibilityLabel="Set this up as a repeat booking">
        <View style={styles.icon}>
          <Ionicons name="repeat" size={19} color={palette.primaryDeep} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight="semibold">
            Does this come back?
          </Text>
          <Text variant="micro" tone="muted">
            We can open the booking for you next time — you still choose who and what you pay.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
      </Card>
    );
  }

  return (
    <Animated.View entering={reduced ? undefined : FadeInDown.duration(260)}>
      <Card style={styles.form}>
        <Text variant="label" weight="bold">
          {`Repeat ${job.category.name.toLowerCase()}`}
        </Text>

        <View style={styles.choices}>
          {CHOICES.map((days) => {
            const active = days === interval;
            return (
              <Pressable
                key={days}
                onPress={() => setInterval(days)}
                accessibilityRole="button"
                accessible
                accessibilityState={{ selected: active }}
                accessibilityLabel={describeInterval(days)}
                style={[styles.choice, active && styles.choiceActive]}
              >
                <Text
                  variant="micro"
                  weight="semibold"
                  style={{ color: active ? palette.textOnPrimary : palette.primaryDeep }}
                  importantForAccessibility="no-hide-descendants"
                >
                  {describeInterval(days).replace('every ', '')}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text variant="micro" tone="muted">
          {`First visit around ${new Date(firstDue()).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}. You can skip, pause or stop it any time.`}
        </Text>

        {error ? (
          <Text variant="micro" tone="danger">
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button title="Not now" size="sm" variant="ghost" style={styles.action} onPress={() => setOpen(false)} />
          <Button title="Set it up" size="sm" style={styles.action} loading={create.isPending} onPress={() => void setUp()} />
        </View>

        {/* Said here as well as on the plans screen, because this is the moment somebody might
            assume a repeat means a standing payment. It does not, and never will. */}
        <Text variant="micro" tone="muted">
          Nothing is charged automatically. Each visit is quoted and paid for on its own.
        </Text>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  prompt: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 13, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  form: { gap: spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    paddingHorizontal: spacing.md,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: palette.primarySoft,
  },
  choiceActive: { backgroundColor: palette.primary },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  doneCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
