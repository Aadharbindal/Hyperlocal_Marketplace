import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import type { ServicePlanView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useServicePlans, useSkipNextVisit, useUpdateServicePlan } from '@/api/hooks';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

/**
 * The work that comes back: the AC before summer, the RO filter, the seasonal clean.
 *
 * The screen's job is to make the arrangement feel like something the customer owns rather than
 * something running at them. Every plan shows the next date plainly, and the two ways out - skip
 * one visit, or pause - are offered before the one that ends it, because "cancel" is what people
 * reach for when they only meant "not this month", and most never set it up again.
 */
export default function ServicePlansScreen() {
  const t = useStrings();
  const router = useRouter();
  const plans = useServicePlans();
  const reduced = useReducedMotion();

  const items = plans.data?.items ?? [];
  const enter = (i: number) => (reduced ? undefined : FadeInDown.delay(i * 70).duration(400));

  return (
    <Screen refreshing={plans.isRefetching} onRefresh={() => void plans.refetch()}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold">
          {t('plans.title')}
        </Text>
      </View>
      <Spacer h={spacing.md} />
      <Text variant="caption" tone="secondary">
        {t('plans.intro')}
      </Text>
      <Spacer h={spacing.xl} />

      {plans.isPending ? (
        <View style={styles.list}>
          <Skeleton height={120} />
          <Skeleton height={120} />
        </View>
      ) : plans.isError ? (
        <ErrorState title={t('common.loadFailed')} onRetry={() => void plans.refetch()} retrying={plans.isRefetching} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="repeat"
          title={t('plans.empty')}
          body={t('plans.empty.body')}
          actionLabel={t('plans.empty.cta')}
          onAction={() => router.push('/(customer)/home')}
        />
      ) : (
        <View style={styles.list}>
          {items.map((plan, i) => (
            <Animated.View key={plan.id} entering={enter(i)}>
              <PlanCard plan={plan} />
            </Animated.View>
          ))}
        </View>
      )}
    </Screen>
  );
}

function PlanCard({ plan }: { plan: ServicePlanView }) {
  const t = useStrings();
  const update = useUpdateServicePlan();
  const skip = useSkipNextVisit();
  const [error, setError] = useState<string | null>(null);

  const paused = plan.status === 'PAUSED';
  const busy = update.isPending || skip.isPending;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.error'));
    }
  };

  /** "Tue, 12 Aug" - a date somebody can picture, not an ISO string. */
  const due = new Date(`${plan.nextDueOn}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  // Only the ones worth showing. A list of every successful month is history, not information;
  // the rows that matter are the ones where nothing happened and the customer should know why.
  const problems = plan.recent.filter((o) => o.outcome !== 'BOOKED').slice(0, 2);

  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardIcon}>
          <Ionicons name="repeat" size={19} color={palette.primaryDeep} />
        </View>
        <View style={styles.cardTitle}>
          <Text variant="label" weight="bold" numberOfLines={1}>
            {plan.categoryName}
          </Text>
          <Text variant="micro" tone="muted" numberOfLines={1}>
            {plan.addressLabel ? `${plan.intervalLabel} · ${plan.addressLabel}` : plan.intervalLabel}
          </Text>
        </View>
        {paused ? <Badge tone="warning" label={t('plans.paused')} /> : null}
      </View>

      <View style={styles.dueRow}>
        <Ionicons name="calendar-outline" size={15} color={palette.textMuted} />
        <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
          {paused ? t('plans.pausedHint') : `${t('plans.next')} ${due}`}
        </Text>
      </View>

      {plan.preferredProviderName ? (
        <View style={styles.dueRow}>
          <Ionicons name="person-outline" size={15} color={palette.textMuted} />
          <Text variant="micro" tone="muted" style={{ flex: 1 }}>
            {`${t('plans.preferred')} ${plan.preferredProviderName}`}
          </Text>
        </View>
      ) : null}

      {problems.map((o) => (
        <View key={o.dueOn} style={styles.problem}>
          <Ionicons name="alert-circle-outline" size={15} color={palette.warning} />
          <Text variant="micro" tone="secondary" style={{ flex: 1 }}>
            {`${o.dueOn}: ${PROBLEM[o.detail ?? ''] ?? t('plans.problem.generic')}`}
          </Text>
        </View>
      ))}

      {error ? (
        <Text variant="micro" tone="danger">
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {!paused && (
          <Button
            title={t('plans.skip')}
            size="sm"
            variant="secondary"
            style={styles.action}
            loading={skip.isPending}
            disabled={busy}
            onPress={() => void run(() => skip.mutateAsync({ id: plan.id }))}
          />
        )}
        <Button
          title={paused ? t('plans.resume') : t('plans.pause')}
          size="sm"
          variant="secondary"
          style={styles.action}
          loading={update.isPending}
          disabled={busy}
          onPress={() => void run(() => update.mutateAsync({ id: plan.id, status: paused ? 'ACTIVE' : 'PAUSED' }))}
        />
      </View>
      {/* Last, and quieter than the other two. */}
      <Button
        title={t('plans.cancel')}
        size="sm"
        variant="ghost"
        fullWidth
        disabled={busy}
        onPress={() => void run(() => update.mutateAsync({ id: plan.id, status: 'CANCELLED' }))}
      />
      <Text variant="micro" tone="muted">
        {t('plans.noCharge')}
      </Text>
    </Card>
  );
}

/** The server's reasons, in words a customer can act on. */
const PROBLEM: Record<string, string> = {
  ADDRESS_GONE: 'we could not book it — that address has been removed',
  CATEGORY_DISABLED: 'we could not book it — that service is paused in your area',
  ALREADY_OPEN: 'skipped — your last booking was still open',
  PAUSED: 'skipped — the plan was paused',
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  list: { gap: spacing.md },
  card: { gap: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { flex: 1, gap: 1 },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  problem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: palette.warningSoft, borderRadius: radius.sm, padding: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
