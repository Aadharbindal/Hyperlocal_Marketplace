import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { formatInr, type FeedFilters, type NearbyJobItem } from '@hyperlocal/core';
import { activeFilterCount } from '@/api/growth';
import { useNearbyJobs, useProviderProfile, useSetAvailability } from '@/api/provider';
import { BidSheet } from '@/features/provider/BidSheet';
import { FeedFilterSheet } from '@/features/provider/FeedFilterSheet';
import { RedispatchInvites } from '@/features/provider/RedispatchInvites';
import { SetupChecklist } from '@/features/provider/SetupChecklist';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Badge, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';
import { RealisticIcon } from '@/ui/RealisticIcon';

function Countdown({ endsAt }: { endsAt: string }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(endsAt).getTime() - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, new Date(endsAt).getTime() - Date.now())), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  if (left <= 0) return null;
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <View style={styles.timer}>
      <Ionicons name="time-outline" size={12} color={left < 300_000 ? palette.danger : palette.primaryDeep} />
      <Text variant="micro" weight="bold" style={{ color: left < 300_000 ? palette.danger : palette.primaryDeep }}>
        {m}:{String(s).padStart(2, '0')}
      </Text>
    </View>
  );
}

export default function ProviderJobsScreen() {
  const t = useStrings();
  const router = useRouter();
  const profile = useProviderProfile();
  const [filters, setFilters] = useState<FeedFilters>({});
  const feed = useNearbyJobs(filters);
  const availability = useSetAvailability();
  const [bidding, setBidding] = useState<NearbyJobItem | null>(null);
  const [filtering, setFiltering] = useState(false);
  const activeFilters = activeFilterCount(filters);

  const blockers = feed.data?.blockers ?? profile.data?.blockers ?? [];
  /**
   * Being suspended is not a setup step.
   *
   * It arrives in the same `blockers` array as the four things a new professional has to finish,
   * and putting it in the checklist would have ticked three boxes and offered a progress bar to
   * somebody whose account is on hold - cheerful, and about the wrong subject. It gets its own
   * message, and the checklist stands down while it is showing.
   */
  const suspended = blockers.includes('SUSPENDED');
  const setupSteps = blockers.filter((b) => b !== 'SUSPENDED');

  return (
    <Screen withTabBar refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()}>
      {/* header with the availability switch */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="title" weight="bold">
            {t('tabs.jobs')}
          </Text>
          <Text variant="caption" tone="secondary">
            {profile.data?.businessName ?? 'Your business'}
          </Text>
        </View>
        {/* Only offered once there is a feed to narrow. */}
        {/* Optional-chained because a crash is a far worse failure than a missing filter
            button. The server sends facets on every path now; this is the belt. */}
        {feed.data?.facets?.total ? (
          <Pressable
            onPress={() => setFiltering(true)}
            accessibilityRole="button"
            accessibilityLabel={activeFilters > 0 ? `Filters, ${activeFilters} active` : 'Filter jobs'}
            style={[styles.filterButton, activeFilters > 0 && styles.filterButtonOn]}
            hitSlop={8}
          >
            <Ionicons name="options-outline" size={18} color={activeFilters > 0 ? palette.textOnPrimary : palette.primaryDeep} />
            {activeFilters > 0 ? (
              <Text variant="micro" weight="bold" style={{ color: palette.textOnPrimary }}>
                {activeFilters}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
        <View style={styles.availability}>
          <Text variant="micro" weight="semibold" tone={profile.data?.isAvailable ? 'primary' : 'muted'}>
            {profile.data?.isAvailable ? 'ONLINE' : 'OFFLINE'}
          </Text>
          <Switch
            value={!!profile.data?.isAvailable}
            onValueChange={(v) => availability.mutate(v)}
            disabled={profile.isPending || availability.isPending || profile.data?.verificationStatus !== 'VERIFIED'}
            trackColor={{ true: palette.primary, false: palette.borderStrong }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Availability"
            /* A disabled switch with no reason is a dead end - the server refuses
               `isAvailable: true` until verification is through (`verification_pending`), so the
               control is correctly off, but silently. Somebody tapping it got nothing at all. */
            accessibilityHint={
              profile.data && profile.data.verificationStatus !== 'VERIFIED'
                ? 'You can go online once your ID has been verified.'
                : undefined
            }
          />
        </View>
      </View>

      {/* Above everything, including the feed. A booking somebody has already paid for and is
          waiting at home for beats any new opportunity on the list, and it expires in twenty
          minutes. Renders nothing when there is nothing to answer. */}
      <RedispatchInvites />

      {/* verification / setup state */}
      {/*
        One list instead of a card plus an empty state.

        Both of those were showing a *single* next step, in two different shapes, while the server
        was already sending the whole list of what it is waiting for. A professional on their first
        day could not tell whether they were nearly done or had barely started. The card below is
        kept only for the two verification states a tick cannot express - being reviewed, and being
        rejected with a reason that has to be read.
      */}
      {suspended ? (
        <Animated.View entering={FadeInDown.duration(360)}>
          <Card style={styles.holdCard}>
            <View style={styles.verifyHead}>
              <Ionicons name="pause-circle" size={20} color={palette.danger} />
              <Text weight="semibold" style={styles.holdTitle}>
                Your account is on hold
              </Text>
            </View>
            <Text variant="caption" tone="secondary">
              No new jobs will reach you until this is lifted. Support can tell you why and what to do next.
            </Text>
            <Pressable accessibilityRole="button" onPress={() => router.push('/support')} style={styles.verifyAction}>
              <Text variant="caption" weight="bold" tone="primary">
                Talk to support
              </Text>
              <Ionicons name="arrow-forward" size={14} color={palette.primary} />
            </Pressable>
          </Card>
        </Animated.View>
      ) : setupSteps.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(360)}>
          <SetupChecklist blockers={setupSteps} onAction={() => router.push('/(provider)/profile')} />
        </Animated.View>
      ) : null}

      {profile.data && (profile.data.verificationStatus === 'SUBMITTED' || profile.data.verificationStatus === 'UNDER_REVIEW' || profile.data.verificationStatus === 'REJECTED') ? (
        <Animated.View entering={FadeInDown.duration(360)}>
          <Spacer h={spacing.md} />
          <Card style={styles.verifyCard}>
            <View style={styles.verifyHead}>
              <Ionicons name="shield-checkmark" size={20} color={palette.warning} />
              <Text weight="semibold" style={styles.verifyTitle}>
                {profile.data.verificationStatus === 'REJECTED' ? 'Your documents came back' : 'Verification in review'}
              </Text>
            </View>
            <Text variant="caption" tone="secondary">
              {profile.data.verificationStatus === 'REJECTED'
                ? (profile.data.kyc[0]?.rejectionReason ?? 'Your documents were not accepted. Please submit again.')
                : 'We are checking your documents. This usually takes a day.'}
            </Text>
            {profile.data.verificationStatus === 'REJECTED' ? (
              <Pressable accessibilityRole="button" onPress={() => router.push('/(provider)/profile')} style={styles.verifyAction}>
                <Text variant="caption" weight="bold" tone="primary">
                  Send them again
                </Text>
                <Ionicons name="arrow-forward" size={14} color={palette.primary} />
              </Pressable>
            ) : null}
          </Card>
        </Animated.View>
      ) : null}

      <Spacer h={spacing.lg} />

      {feed.isPending || profile.isPending ? (
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <Card key={i} style={styles.jobCard}>
              <Skeleton height={16} width="50%" />
              <Skeleton height={12} width="85%" />
              <Skeleton height={36} />
            </Card>
          ))}
        </View>
      ) : feed.isError ? (
        <ErrorState title={t('common.loadFailed')} body={t('common.checkConnection')} onRetry={() => void feed.refetch()} retrying={feed.isRefetching} />
      ) : blockers.length > 0 ? (
        /* No task here - the checklist above is already carrying all of them, in full, which is
           what the two competing instructions were doing badly. This only answers the question the
           blank space below the card asks: what is this list, and why is it empty. */
        <EmptyState
          icon="briefcase-outline"
          title="No jobs yet"
          body={
            suspended
              ? 'Jobs near you will appear here once your account is active again.'
              : 'Once the list above is done, jobs near you appear here - usually within a few minutes.'
          }
        />
      ) : feed.data.items.length === 0 ? (
        <EmptyState
          icon={activeFilters > 0 ? 'funnel-outline' : 'briefcase-outline'}
          title={activeFilters > 0 ? 'Nothing matches those filters' : t('jobs.empty.title')}
          // An empty feed with no explanation reads as "there is no work", which is a different
          // and much worse message than "your filters are narrow".
          body={feed.data.emptyReason ?? 'New jobs near you will appear here as customers post them.'}
          actionLabel={activeFilters > 0 ? 'Clear filters' : undefined}
          onAction={activeFilters > 0 ? () => setFilters({}) : undefined}
        />
      ) : (
        <View style={styles.list}>
          {feed.data.items.map((job, i) => (
            <Animated.View key={job.jobId} entering={FadeInDown.delay(i * 60).duration(360)}>
              <JobCard job={job} onBid={() => setBidding(job)} />
            </Animated.View>
          ))}
        </View>
      )}

      <BidSheet job={bidding} onClose={() => setBidding(null)} />
      <FeedFilterSheet
        visible={filtering}
        onClose={() => setFiltering(false)}
        filters={filters}
        facets={feed.data?.facets}
        onApply={setFilters}
      />
    </Screen>
  );
}

function JobCard({ job, onBid }: { job: NearbyJobItem; onBid: () => void }) {
  const mine = job.myBid;
  return (
    <Card style={styles.jobCard}>
      <View style={styles.jobHead}>
        <RealisticIcon iconKey={job.categoryIconKey} size={38} />
        <View style={styles.jobHeadText}>
          <View style={styles.jobTitleRow}>
            <Text variant="label" weight="semibold">
              {job.categoryName}
            </Text>
            {job.priority === 'URGENT' && <Badge tone="warning" icon="flash" label="Urgent" />}
            {job.requestType === 'LABOUR_AND_MATERIAL' && <Badge tone="info" label="Materials" />}
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={13} color={palette.textMuted} />
            <Text variant="micro" tone="muted">
              {job.distanceKm} km · {job.areaLabel}
            </Text>
            {job.photoCount > 0 && (
              <>
                <Ionicons name="image-outline" size={13} color={palette.textMuted} />
                <Text variant="micro" tone="muted">
                  {job.photoCount}
                </Text>
              </>
            )}
            {job.hasVoiceNote && <Ionicons name="mic-outline" size={13} color={palette.textMuted} />}
          </View>
        </View>
        {job.bidWindowEndsAt && <Countdown endsAt={job.bidWindowEndsAt} />}
      </View>

      {job.description ? (
        <Text variant="caption" tone="secondary" numberOfLines={2}>
          {job.description}
        </Text>
      ) : null}

      <View style={styles.jobFoot}>
        <Text variant="micro" tone="muted">
          {job.bidCount === 0 ? 'Be the first to offer' : `${job.bidCount} offer${job.bidCount > 1 ? 's' : ''} so far`}
        </Text>
        {mine ? (
          <Pressable accessibilityRole="button" onPress={onBid} style={[styles.bidBtn, styles.bidBtnMine]}>
            <Ionicons name="create-outline" size={15} color={palette.primaryDeep} />
            <Text variant="caption" weight="bold" tone="primary">
              {formatInr(mine.labourPaise + mine.visitFeePaise)} · Edit
            </Text>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" onPress={onBid} style={styles.bidBtn}>
            <Text variant="caption" weight="bold" style={styles.bidBtnText}>
              Send offer
            </Text>
            <Ionicons name="arrow-forward" size={15} color={palette.textOnPrimary} />
          </Pressable>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.primarySoft,
  },
  filterButtonOn: { backgroundColor: palette.primary },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerText: { flex: 1 },
  availability: { alignItems: 'center', gap: 2 },

  holdCard: { marginTop: spacing.md, gap: spacing.sm, backgroundColor: palette.dangerSoft, borderWidth: 1, borderColor: palette.danger },
  holdTitle: { fontSize: 15, color: palette.danger },
  verifyCard: { marginTop: spacing.lg, gap: spacing.sm, backgroundColor: '#FFFBF0', borderWidth: 1, borderColor: palette.warningSoft },
  verifyHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  verifyTitle: { fontSize: 15, color: palette.warning },
  verifyAction: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.xs, minHeight: 36 },

  list: { gap: spacing.md },
  jobCard: { gap: spacing.md },
  jobHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  jobHeadText: { flex: 1, gap: 4 },
  jobTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: palette.primarySoft, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },

  jobFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bidBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.primary, paddingHorizontal: spacing.lg, minHeight: 40, borderRadius: radius.pill },
  bidBtnMine: { backgroundColor: palette.primarySoft },
  bidBtnText: { color: palette.textOnPrimary },
});
