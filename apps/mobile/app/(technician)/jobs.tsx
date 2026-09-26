import { Ionicons } from '@expo/vector-icons';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { JobStatus } from '@hyperlocal/core';
import type { TechnicianJob } from '@/api/technician';
import { useTechnicianJobs, useTechnicianProfile } from '@/api/technician';
import { JobRunner } from '@/features/provider/JobRunner';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Badge, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

/**
 * Where a technician is going next.
 *
 * Until this screen, a technician was handed the provider app: a bidding feed they cannot use
 * and an earnings tab showing money that belongs to their contractor. What they actually need
 * is two things - the address, and the controls to run the job once they are standing at it.
 *
 * The full address is here on purpose. Somebody who has been assigned has to be able to arrive,
 * and a screen that shows them "Green Park, Delhi" is a screen they work around by ringing the
 * customer - which is the number they are not supposed to have.
 */

const LIVE = ['PROVIDER_ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'IN_PROGRESS', 'PRICE_REVISION_PENDING', 'COMPLETION_PENDING'];

export default function TechnicianJobsScreen() {
  const t = useStrings();
  const profile = useTechnicianProfile();
  const jobs = useTechnicianJobs();

  const verified = profile.data?.verificationStatus === 'VERIFIED';
  const live = (jobs.data ?? []).filter((j) => LIVE.includes(j.status));

  return (
    <Screen withTabBar refreshing={jobs.isRefetching} onRefresh={() => void jobs.refetch()}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="title" weight="bold">
            {t('tabs.jobs')}
          </Text>
          <Text variant="caption" tone="secondary">
            {profile.data?.teamName ? `With ${profile.data.teamName}` : 'Your assigned work'}
          </Text>
        </View>
      </View>
      <Spacer h={spacing.lg} />

      {/* Said plainly rather than shown as an empty list: an unverified technician cannot be
          assigned at all, so "no jobs" would be the wrong explanation. */}
      {profile.data && !verified ? (
        <>
          <Card style={styles.notice}>
            <Ionicons name="shield-outline" size={20} color="#B26A00" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" weight="semibold" style={{ color: '#7A5200' }}>
                Waiting on your verification
              </Text>
              <Text variant="micro" style={{ color: '#7A5200' }}>
                Your team submits your documents and our staff review them. Until that is done you
                cannot be sent to a customer.
              </Text>
            </View>
          </Card>
          <Spacer h={spacing.md} />
        </>
      ) : null}

      {jobs.isPending ? (
        <View style={styles.list}>
          <Skeleton height={130} />
          <Skeleton height={130} />
        </View>
      ) : jobs.isError ? (
        <ErrorState title={t('common.loadFailed')} body={t('common.checkConnection')} onRetry={() => void jobs.refetch()} />
      ) : jobs.data.length === 0 ? (
        <EmptyState
          icon="navigate-outline"
          title="Nothing assigned"
          body={
            verified
              ? 'When your team puts you on a job it appears here, with the address.'
              : 'Once you are verified, jobs your team assigns you will appear here.'
          }
        />
      ) : (
        <View style={styles.list}>
          {jobs.data.map((job, i) => (
            <Animated.View key={job.jobId} entering={FadeInDown.delay(Math.min(i, 6) * 50).duration(320)}>
              <JobCard job={job} live={LIVE.includes(job.status)} />
            </Animated.View>
          ))}
        </View>
      )}

      {live.length === 0 && jobs.data && jobs.data.length > 0 ? (
        <>
          <Spacer h={spacing.md} />
          <Text variant="micro" tone="muted" center>
            Nothing live right now.
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

function JobCard({ job, live }: { job: TechnicianJob; live: boolean }) {
  async function navigate() {
    // Handed to whichever maps app they already use, rather than a map we would have to build
    // and they would have to learn.
    const query = job.lat != null && job.lng != null ? `${job.lat},${job.lng}` : encodeURIComponent(job.address ?? '');
    const url = `https://www.google.com/maps/dir/?api=1&destination=${query}`;
    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
  }

  return (
    <Card style={[styles.card, live && styles.cardLive]}>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight="bold">
            {job.categoryName}
          </Text>
          <Text variant="micro" tone="muted">
            {job.customerName}
            {job.preferredStart
              ? ` · ${new Date(job.preferredStart).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
              : ''}
          </Text>
        </View>
        <Badge tone={live ? 'primary' : 'neutral'} label={job.status.replace(/_/g, ' ').toLowerCase()} />
      </View>

      {job.description ? (
        <Text variant="caption" tone="secondary" numberOfLines={3}>
          {job.description}
        </Text>
      ) : null}

      {job.address ? (
        <Pressable onPress={() => void navigate()} accessibilityRole="button" accessibilityLabel="Open directions" style={styles.address}>
          <Ionicons name="location-outline" size={18} color={palette.primary} />
          <Text variant="micro" tone="secondary" style={{ flex: 1 }}>
            {job.address}
          </Text>
          <Ionicons name="navigate" size={16} color={palette.primary} />
        </Pressable>
      ) : null}

      {/* The same controls the provider uses, because the job runs the same way whoever is
          standing in front of it. */}
      {live ? (
        <>
          <Spacer h={spacing.xs} />
          <JobRunner jobId={job.jobId} status={job.status as JobStatus} categoryName={job.categoryName} />
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#FFF6E5' },
  list: { gap: spacing.sm },
  card: { gap: spacing.sm },
  cardLive: { borderWidth: 1, borderColor: palette.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  address: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#F6FBF9',
    borderRadius: radius.md,
    padding: spacing.md,
  },
});
