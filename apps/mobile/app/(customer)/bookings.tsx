import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { JobListItem } from '@hyperlocal/core';
import { useJobs } from '@/api/jobs';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Badge, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';
import { RealisticIcon } from '@/ui/RealisticIcon';

const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'past', label: 'Past' },
] as const;

const LIVE_KEYS = new Set(['status.finding_providers', 'status.offers_received', 'status.on_the_way', 'status.arrived', 'status.work_started']);

export default function BookingsScreen() {
  const t = useStrings();
  const router = useRouter();
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const jobs = useJobs(tab);

  return (
    <Screen withTabBar refreshing={jobs.isRefetching} onRefresh={() => void jobs.refetch()}>
      <Text variant="title" weight="bold">
        {t('tabs.bookings')}
      </Text>
      <Spacer h={spacing.lg} />

      <View style={styles.tabs}>
        {TABS.map((x) => {
          const active = x.key === tab;
          return (
            <Pressable key={x.key} onPress={() => setTab(x.key)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={[styles.tab, active && styles.tabActive]}>
              <Text variant="label" weight="semibold" style={active ? styles.tabTextActive : undefined}>
                {x.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Spacer h={spacing.lg} />

      {jobs.isPending ? (
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <Card key={i} style={styles.item}>
              <Skeleton width={52} height={52} />
              <View style={styles.itemBody}>
                <Skeleton height={14} width="55%" />
                <Skeleton height={12} width="80%" />
              </View>
            </Card>
          ))}
        </View>
      ) : jobs.isError ? (
        <ErrorState title={t('common.loadFailed')} body={t('common.checkConnection')} onRetry={() => void jobs.refetch()} retrying={jobs.isRefetching} />
      ) : jobs.data.items.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title={tab === 'active' ? 'No active bookings' : 'Nothing here yet'}
          body={tab === 'active' ? 'Book a service and track it live here.' : 'Completed and cancelled bookings will appear here.'}
          actionLabel={tab === 'active' ? 'Book a service' : undefined}
          onAction={() => router.push('/(customer)/book')}
        />
      ) : (
        <View style={styles.list}>
          {jobs.data.items.map((j, i) => (
            <Animated.View key={j.id} entering={FadeInDown.delay(i * 60).duration(380)}>
              <BookingCard job={j} label={t(j.statusLabelKey as never)} onPress={() => router.push({ pathname: '/(customer)/job/[id]', params: { id: j.id } })} />
            </Animated.View>
          ))}
        </View>
      )}
    </Screen>
  );
}

function BookingCard({ job, label, onPress }: { job: JobListItem; label: string; onPress: () => void }) {
  const live = LIVE_KEYS.has(job.statusLabelKey);
  return (
    <Card onPress={onPress} style={styles.item} accessibilityLabel={`${job.categoryName} booking, ${label}`}>
      {job.thumbnailUrl?.startsWith('http') ? (
        <Image source={{ uri: job.thumbnailUrl }} style={styles.thumb} />
      ) : (
        <View style={styles.thumbFallback}>
          <RealisticIcon iconKey={job.categoryIconKey} size={34} />
        </View>
      )}
      <View style={styles.itemBody}>
        <View style={styles.itemHead}>
          <Text variant="label" weight="semibold">
            {job.categoryName}
          </Text>
          {job.priority === 'URGENT' && <Badge tone="warning" icon="flash" label="Urgent" />}
        </View>
        {job.description ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {job.description}
          </Text>
        ) : null}
        <View style={styles.itemFoot}>
          <View style={[styles.statusPill, live && styles.statusPillLive]}>
            {live && <View style={styles.liveDot} />}
            <Text variant="micro" weight="semibold" style={live ? styles.statusTextLive : styles.statusText}>
              {label}
            </Text>
          </View>
          <Text variant="micro" tone="muted">
            {new Date(job.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
    </Card>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: spacing.sm, backgroundColor: palette.surfaceMuted, borderRadius: radius.pill, padding: 4 },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  tabActive: { backgroundColor: palette.surface },
  tabTextActive: { color: palette.primaryDeep },

  list: { gap: spacing.md },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 52, height: 52, borderRadius: radius.md },
  thumbFallback: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: palette.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  itemBody: { flex: 1, gap: 3 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: palette.surfaceMuted },
  statusPillLive: { backgroundColor: palette.primarySoft },
  statusText: { color: palette.textSecondary },
  statusTextLive: { color: palette.primaryDeep },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.primary },
});
