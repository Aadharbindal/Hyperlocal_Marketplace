import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, Share, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import type { JobStatus } from '@hyperlocal/core';
import { ApiError, API_URL } from '@/api/client';
import { useCancelJob, useJob } from '@/api/jobs';
import { BookingCard } from '@/features/customer/BookingCard';
import { LiveJobPanel } from '@/features/customer/LiveJobPanel';
import { MaterialPanel } from '@/features/customer/MaterialPanel';
import { OffersList } from '@/features/customer/OffersList';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Button, Card, ErrorState, IconButton, Screen, Skeleton, Text } from '@/ui';
import { RealisticIcon } from '@/ui/RealisticIcon';

const LIVE: JobStatus[] = ['SUBMITTED', 'QUALIFYING', 'OPEN_FOR_BIDS', 'BID_RECEIVED', 'NEGOTIATING'];
const CANCELLABLE: JobStatus[] = ['DRAFT', 'SUBMITTED', 'QUALIFYING', 'OPEN_FOR_BIDS', 'BID_RECEIVED', 'NEGOTIATING', 'PAYMENT_PENDING', 'CONFIRMED'];

/** The customer-facing milestones; the server owns the real state machine. */
const MILESTONES: Array<{ key: string; label: string; statuses: JobStatus[] }> = [
  { key: 'submitted', label: 'Request submitted', statuses: ['SUBMITTED', 'QUALIFYING'] },
  { key: 'finding', label: 'Finding providers', statuses: ['OPEN_FOR_BIDS'] },
  { key: 'offers', label: 'Offers received', statuses: ['BID_RECEIVED', 'NEGOTIATING'] },
  { key: 'confirmed', label: 'Provider confirmed', statuses: ['PAYMENT_PENDING', 'CONFIRMED', 'PROVIDER_ASSIGNED'] },
  { key: 'work', label: 'Work in progress', statuses: ['EN_ROUTE', 'ARRIVED', 'STARTED', 'IN_PROGRESS', 'PRICE_REVISION_PENDING'] },
  { key: 'done', label: 'Completed', statuses: ['COMPLETION_PENDING', 'CUSTOMER_APPROVAL_PENDING', 'COMPLETED', 'SETTLED'] },
];

function reachedIndex(status: JobStatus): number {
  const idx = MILESTONES.findIndex((m) => m.statuses.includes(status));
  return idx === -1 ? 0 : idx;
}

function Countdown({ endsAt }: { endsAt: string }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(endsAt).getTime() - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, new Date(endsAt).getTime() - Date.now())), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <Text weight="bold" style={styles.countdown}>
      {m}:{String(s).padStart(2, '0')}
    </Text>
  );
}

export default function JobDetailScreen() {
  const t = useStrings();
  const router = useRouter();
  const { id, duplicateOf } = useLocalSearchParams<{ id: string; duplicateOf?: string }>();
  const [cancelError, setCancelError] = useState<string | null>(null);
  const job = useJob(id, { poll: true });
  const cancel = useCancelJob();

  const status = job.data?.status;
  const live = !!status && LIVE.includes(status);

  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.ease) }), -1, false);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.value * 0.6 }], opacity: 0.3 * (1 - pulse.value) }));

  async function shareTracking() {
    if (!job.data?.trackingUrlToken) return;
    await Share.share({
      message: `Track the ${job.data.category.name} visit: ${API_URL}/track/${job.data.trackingUrlToken}`,
    });
  }

  async function onCancel() {
    setCancelError(null);
    try {
      await cancel.mutateAsync({ jobId: id, reason: 'Cancelled from the app' });
    } catch (e) {
      setCancelError(e instanceof ApiError ? e.message : t('common.error'));
    }
  }

  if (job.isPending) {
    return (
      <Screen withTabBar>
        <Skeleton height={28} width="60%" />
        <View style={{ height: spacing.lg }} />
        <Skeleton height={140} />
        <View style={{ height: spacing.lg }} />
        <Skeleton height={220} />
      </Screen>
    );
  }
  if (job.isError || !job.data) {
    return (
      <Screen withTabBar>
        <ErrorState title={t('common.loadFailed')} body={t('common.checkConnection')} onRetry={() => void job.refetch()} retrying={job.isRefetching} />
      </Screen>
    );
  }

  const j = job.data;
  const reached = reachedIndex(j.status);
  const cancelled = j.status.startsWith('CANCELLED') || j.status === 'AUTO_CANCELLED';

  return (
    <Screen withTabBar refreshing={job.isRefetching} onRefresh={() => void job.refetch()}>
      <View style={styles.header}>
        <IconButton icon="arrow-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <View style={styles.headerText}>
          <Text variant="heading" weight="bold">
            {j.category.name}
          </Text>
          <Text variant="caption" tone="secondary">
            Booking #{j.id.slice(0, 8).toUpperCase()}
          </Text>
        </View>
        {j.trackingUrlToken && <IconButton icon="share-social-outline" accessibilityLabel="Share tracking link" onPress={shareTracking} />}
      </View>

      {duplicateOf ? (
        <Animated.View entering={FadeIn.duration(300)} style={styles.notice}>
          <Ionicons name="information-circle" size={18} color="#8A6400" />
          <Text variant="caption" weight="medium" style={styles.noticeText}>
            You already have an open request for this service at the same address.
          </Text>
        </Animated.View>
      ) : null}

      {/* live status hero */}
      <Animated.View entering={FadeInDown.duration(420)}>
        <LinearGradient colors={cancelled ? ['#8A9B94', '#5B6E67'] : ['#12886A', '#0A6A51']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.statusDotWrap}>
              {live && <Animated.View style={[styles.statusPulse, pulseStyle]} />}
              <View style={styles.statusDot} />
            </View>
            <Text variant="subheading" weight="bold" tone="onPrimary">
              {t(j.statusLabelKey as never)}
            </Text>
          </View>
          {j.status === 'OPEN_FOR_BIDS' && j.bidWindowEndsAt ? (
            <View style={styles.heroRow}>
              <Text variant="caption" tone="onPrimaryMuted">
                Offers close in
              </Text>
              <Countdown endsAt={j.bidWindowEndsAt} />
            </View>
          ) : (
            <Text variant="caption" tone="onPrimaryMuted">
              {cancelled ? (j.cancelledReason ?? 'This request was cancelled.') : 'We will notify you the moment something changes.'}
            </Text>
          )}
          {j.priority === 'URGENT' && <View style={styles.urgentPill}><Ionicons name="flash" size={12} color="#8A6400" /><Text variant="micro" weight="bold" style={{ color: '#8A6400' }}>URGENT</Text></View>}
        </LinearGradient>
      </Animated.View>

      {/* milestones */}
      <Animated.View entering={FadeInDown.delay(90).duration(420)}>
        <Card style={styles.card}>
          {MILESTONES.map((m, i) => {
            const done = !cancelled && i < reached;
            const current = !cancelled && i === reached;
            return (
              <View key={m.key} style={styles.milestone}>
                <View style={styles.milestoneRail}>
                  <View style={[styles.milestoneDot, done && styles.dotDone, current && styles.dotCurrent]}>
                    {done && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
                  </View>
                  {i < MILESTONES.length - 1 && <View style={[styles.milestoneLine, done && styles.lineDone]} />}
                </View>
                <Text variant="label" weight={current ? 'bold' : 'regular'} tone={done || current ? 'default' : 'muted'} style={styles.milestoneLabel}>
                  {m.label}
                </Text>
              </View>
            );
          })}
        </Card>
      </Animated.View>

      {/* the confirmed booking, once a quote is locked */}
      <BookingCard jobId={j.id} enabled={!!j.bidWindowEndsAt || j.status !== 'OPEN_FOR_BIDS'} />

      {/* offers still open for comparison */}
      <LiveJobPanel jobId={j.id} status={j.status} />

      <MaterialPanel jobId={j.id} status={j.status} />

      <OffersList jobId={j.id} live={live} />

      {/* request summary */}
      <Animated.View entering={FadeInDown.delay(160).duration(420)}>
        <Card style={styles.card}>
          <View style={styles.summaryHead}>
            <RealisticIcon iconKey={j.category.iconKey} size={40} />
            <View style={styles.summaryText}>
              <Text variant="label" weight="semibold">
                {j.requestType === 'LABOUR_AND_MATERIAL' ? 'Labour + materials' : 'Labour only'}
              </Text>
              {j.preferredStart && (
                <Text variant="caption" tone="secondary">
                  Preferred {new Date(j.preferredStart).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                </Text>
              )}
            </View>
          </View>

          {j.description ? (
            <Text variant="body" style={styles.description}>
              {j.description}
            </Text>
          ) : null}

          {j.media.length > 0 && (
            <View style={styles.mediaRow}>
              {j.media.map((m) =>
                m.url.startsWith('http') ? (
                  <Image key={m.id} source={{ uri: m.url }} style={styles.mediaThumb} />
                ) : (
                  <View key={m.id} style={[styles.mediaThumb, styles.mediaPlaceholder]}>
                    <Ionicons name={m.kind === 'VOICE_NOTE' ? 'mic' : 'image'} size={20} color={palette.primary} />
                  </View>
                ),
              )}
            </View>
          )}

          {j.address && (
            <View style={styles.addressRow}>
              <Ionicons name="location" size={16} color={palette.primary} />
              <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                {j.address.label} · {j.address.line1}, {j.address.city} {j.address.pincode}
              </Text>
            </View>
          )}

          {j.bookedForName && (
            <View style={styles.addressRow}>
              <Ionicons name="person" size={16} color={palette.primary} />
              <Text variant="caption" tone="secondary">
                For {j.bookedForName} {j.bookedForPhoneMasked ? `· ${j.bookedForPhoneMasked}` : ''}
              </Text>
            </View>
          )}
        </Card>
      </Animated.View>

      {/* full history */}
      <Animated.View entering={FadeInDown.delay(230).duration(420)}>
        <Card style={styles.card}>
          <Text weight="semibold" style={styles.cardTitle}>
            Activity
          </Text>
          {j.events.map((e) => (
            <View key={e.id} style={styles.event}>
              <View style={styles.eventDot} />
              <View style={{ flex: 1 }}>
                <Text variant="caption" weight="medium">
                  {e.reason ?? e.toStatus}
                </Text>
                <Text variant="micro" tone="muted">
                  {new Date(e.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      </Animated.View>

      {cancelError && (
        <Text variant="caption" tone="danger" center style={styles.cancelError}>
          {cancelError}
        </Text>
      )}

      {CANCELLABLE.includes(j.status) && (
        <Button title="Cancel this request" variant="danger" size="md" icon="close-circle-outline" style={styles.cancelBtn} loading={cancel.isPending} onPress={onCancel} />
      )}

      {j.trackingUrlToken && (
        <Pressable accessibilityRole="button" onPress={shareTracking} style={styles.shareRow}>
          <Ionicons name="link-outline" size={16} color={palette.primary} />
          <Text variant="caption" weight="semibold" tone="primary">
            Share live status with someone at home
          </Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  headerText: { flex: 1 },

  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#FFF6E0', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  noticeText: { color: '#8A6400', flex: 1 },

  hero: { borderRadius: radius.xl, padding: spacing.xl, gap: spacing.sm, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statusDotWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF' },
  statusPulse: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF' },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  countdown: { fontSize: 22, color: '#FFFFFF' },
  urgentPill: { position: 'absolute', top: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFE8B8', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },

  card: { marginTop: spacing.lg, gap: spacing.md },
  cardTitle: { fontSize: 15 },

  milestone: { flexDirection: 'row', gap: spacing.md },
  milestoneRail: { alignItems: 'center', width: 22 },
  milestoneDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: palette.border, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: palette.primary, borderColor: palette.primary },
  dotCurrent: { borderColor: palette.primary, backgroundColor: '#FFFFFF', borderWidth: 5 },
  milestoneLine: { width: 2, flex: 1, minHeight: 18, backgroundColor: palette.border, marginVertical: 2 },
  lineDone: { backgroundColor: palette.primary },
  milestoneLabel: { flex: 1, paddingBottom: spacing.md },

  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryText: { flex: 1 },
  description: { fontSize: 14.5, lineHeight: 21, color: palette.textSecondary },
  mediaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  mediaThumb: { width: 64, height: 64, borderRadius: radius.sm },
  mediaPlaceholder: { backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  event: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  eventDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.primary, marginTop: 6 },

  cancelError: { marginTop: spacing.md },
  cancelBtn: { alignSelf: 'center', marginTop: spacing.xl },
  shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.lg, minHeight: 40 },
});
