import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { formatInr, type NearbyJobItem } from '@hyperlocal/core';
import { useNearbyJobs, useProviderProfile, useSetAvailability } from '@/api/provider';
import { BidSheet } from '@/features/provider/BidSheet';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Badge, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';
import { RealisticIcon } from '@/ui/RealisticIcon';

const BLOCKER_COPY: Record<string, { title: string; body: string; action?: string }> = {
  VERIFICATION_PENDING: { title: 'Verification pending', body: 'Submit your ID to start receiving jobs.', action: 'Complete verification' },
  AVAILABILITY_OFF: { title: "You're offline", body: 'Turn availability on to receive nearby jobs.' },
  NO_SKILLS_SELECTED: { title: 'Pick your services', body: 'Choose what you work on so we can match you.', action: 'Choose services' },
  NO_BASE_LOCATION: { title: 'Set your base location', body: 'We use it to find jobs near you.', action: 'Set location' },
  SUSPENDED: { title: 'Account on hold', body: 'Contact support to restore your account.' },
};

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
  const feed = useNearbyJobs();
  const availability = useSetAvailability();
  const [bidding, setBidding] = useState<NearbyJobItem | null>(null);

  const blockers = feed.data?.blockers ?? profile.data?.blockers ?? [];
  const primaryBlocker = blockers.find((b) => b !== 'AVAILABILITY_OFF') ?? blockers[0];

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
          />
        </View>
      </View>

      {/* verification / setup state */}
      {profile.data && profile.data.verificationStatus !== 'VERIFIED' ? (
        <Animated.View entering={FadeInDown.duration(360)}>
          <Card style={styles.verifyCard}>
            <View style={styles.verifyHead}>
              <Ionicons name="shield-checkmark" size={20} color="#8A6400" />
              <Text weight="semibold" style={styles.verifyTitle}>
                {profile.data.verificationStatus === 'SUBMITTED' || profile.data.verificationStatus === 'UNDER_REVIEW'
                  ? 'Verification in review'
                  : 'Get verified to start'}
              </Text>
            </View>
            <Text variant="caption" tone="secondary">
              {profile.data.verificationStatus === 'REJECTED'
                ? (profile.data.kyc[0]?.rejectionReason ?? 'Your documents were not accepted. Please submit again.')
                : profile.data.verificationStatus === 'SUBMITTED' || profile.data.verificationStatus === 'UNDER_REVIEW'
                  ? 'We are checking your documents. This usually takes a day.'
                  : 'Submit one ID document so customers know you are verified.'}
            </Text>
            {profile.data.verificationStatus !== 'SUBMITTED' && profile.data.verificationStatus !== 'UNDER_REVIEW' && (
              <Pressable accessibilityRole="button" onPress={() => router.push('/(provider)/profile')} style={styles.verifyAction}>
                <Text variant="caption" weight="bold" tone="primary">
                  Complete verification
                </Text>
                <Ionicons name="arrow-forward" size={14} color={palette.primary} />
              </Pressable>
            )}
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
      ) : blockers.length > 0 && primaryBlocker ? (
        <EmptyState
          icon={primaryBlocker === 'AVAILABILITY_OFF' ? 'power-outline' : 'shield-outline'}
          title={BLOCKER_COPY[primaryBlocker]?.title ?? t('jobs.empty.title')}
          body={BLOCKER_COPY[primaryBlocker]?.body ?? t('jobs.empty.body')}
          actionLabel={BLOCKER_COPY[primaryBlocker]?.action}
          onAction={() => router.push('/(provider)/profile')}
        />
      ) : feed.data.items.length === 0 ? (
        <EmptyState icon="briefcase-outline" title={t('jobs.empty.title')} body="New jobs near you will appear here as customers post them." />
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
            <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
          </Pressable>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerText: { flex: 1 },
  availability: { alignItems: 'center', gap: 2 },

  verifyCard: { marginTop: spacing.lg, gap: spacing.sm, backgroundColor: '#FFFBF0', borderWidth: 1, borderColor: '#FFE8B8' },
  verifyHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  verifyTitle: { fontSize: 15, color: '#8A6400' },
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
  bidBtnText: { color: '#FFFFFF' },
});
