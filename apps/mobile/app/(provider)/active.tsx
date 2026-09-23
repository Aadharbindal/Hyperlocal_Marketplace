import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { formatInr, JOB_STATUS_LABEL_KEY, type JobStatus } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useOfferChain } from '@/api/negotiation';
import { useMyBids, useWithdrawBid, type ProviderBidItem } from '@/api/provider';
import { CounterOfferCard } from '@/features/provider/CounterOfferCard';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Badge, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';
import { RealisticIcon } from '@/ui/RealisticIcon';

const STATUS_TONE: Record<string, 'primary' | 'success' | 'neutral' | 'danger'> = {
  ACTIVE: 'primary',
  ACCEPTED: 'success',
  WITHDRAWN: 'neutral',
  REJECTED: 'neutral',
  EXPIRED: 'neutral',
  INACTIVE: 'neutral',
};

export default function ProviderActiveScreen() {
  const t = useStrings();
  const bids = useMyBids();
  const withdraw = useWithdrawBid();
  const [error, setError] = useState<string | null>(null);

  const live = bids.data?.items.filter((b) => b.status === 'ACTIVE') ?? [];
  const closed = bids.data?.items.filter((b) => b.status !== 'ACTIVE') ?? [];

  async function onWithdraw(bidId: string) {
    setError(null);
    try {
      await withdraw.mutateAsync({ bidId, reason: 'Withdrawn from the app' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.error'));
    }
  }

  return (
    <Screen withTabBar refreshing={bids.isRefetching} onRefresh={() => void bids.refetch()}>
      <Text variant="title" weight="bold">
        My offers
      </Text>
      <Spacer h={spacing.lg} />

      {bids.isPending ? (
        <View style={styles.list}>
          {[0, 1].map((i) => (
            <Card key={i} style={styles.card}>
              <Skeleton height={16} width="45%" />
              <Skeleton height={12} width="80%" />
            </Card>
          ))}
        </View>
      ) : bids.isError ? (
        <ErrorState title={t('common.loadFailed')} body={t('common.checkConnection')} onRetry={() => void bids.refetch()} retrying={bids.isRefetching} />
      ) : bids.data.items.length === 0 ? (
        <EmptyState icon="flash-outline" title="No offers yet" body="Offers you send from the Jobs tab will show here with their status." />
      ) : (
        <>
          {error && (
            <Text variant="caption" tone="danger" center style={styles.error}>
              {error}
            </Text>
          )}
          {live.length > 0 && (
            <>
              <Text weight="semibold" style={styles.section}>
                Waiting on the customer
              </Text>
              <View style={styles.list}>
                {live.map((b, i) => (
                  <Animated.View key={b.id} entering={FadeInDown.delay(i * 60).duration(360)}>
                    <PendingCounter bid={b} />
                    <BidRow bid={b} onWithdraw={() => onWithdraw(b.id)} withdrawing={withdraw.isPending} />
                  </Animated.View>
                ))}
              </View>
            </>
          )}
          {closed.length > 0 && (
            <>
              <Text weight="semibold" style={styles.section}>
                Past offers
              </Text>
              <View style={styles.list}>
                {closed.map((b) => (
                  <BidRow key={b.id} bid={b} />
                ))}
              </View>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

/** Shows the customer's counter-offer above the provider's own offer, when one is waiting. */
function PendingCounter({ bid }: { bid: ProviderBidItem }) {
  const chain = useOfferChain(bid.job.id, true);
  const waiting = chain.data?.items.find((o) => o.bidId === bid.id && o.awaitingYou);
  if (!waiting) return null;
  return (
    <View style={styles.counterWrap}>
      <CounterOfferCard jobId={bid.job.id} offer={waiting} currentPaise={bid.labourPaise + bid.visitFeePaise} categoryName={bid.job.categoryName} />
    </View>
  );
}

function BidRow({ bid, onWithdraw, withdrawing }: { bid: ProviderBidItem; onWithdraw?: () => void; withdrawing?: boolean }) {
  const t = useStrings();
  const jobStatusKey = JOB_STATUS_LABEL_KEY[bid.job.status as JobStatus];
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <RealisticIcon iconKey={bid.job.categoryIconKey} size={34} />
        <View style={styles.headText}>
          <View style={styles.titleRow}>
            <Text variant="label" weight="semibold">
              {bid.job.categoryName}
            </Text>
            {bid.job.priority === 'URGENT' && <Badge tone="warning" icon="flash" label="Urgent" />}
          </View>
          <Text variant="micro" tone="muted">
            {bid.job.areaLabel} · {jobStatusKey ? t(jobStatusKey as never) : bid.job.status}
          </Text>
        </View>
        <Badge tone={STATUS_TONE[bid.status] ?? 'neutral'} label={bid.status.toLowerCase()} />
      </View>

      {bid.job.description ? (
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {bid.job.description}
        </Text>
      ) : null}

      <View style={styles.amounts}>
        <View>
          <Text variant="micro" tone="muted">
            Your offer
          </Text>
          <Text variant="label" weight="bold">
            {formatInr(bid.labourPaise + bid.visitFeePaise)}
          </Text>
        </View>
        <View>
          <Text variant="micro" tone="muted">
            Reaches in
          </Text>
          <Text variant="label" weight="semibold">
            {bid.etaMinutes < 60 ? `${bid.etaMinutes} min` : `${Math.round(bid.etaMinutes / 60)} h`}
          </Text>
        </View>
        <View>
          <Text variant="micro" tone="muted">
            Revisions left
          </Text>
          <Text variant="label" weight="semibold">
            {bid.revisionsLeft}
          </Text>
        </View>
      </View>

      {onWithdraw && (
        <Pressable accessibilityRole="button" onPress={onWithdraw} disabled={withdrawing} style={styles.withdraw}>
          <Ionicons name="close-circle-outline" size={15} color={palette.danger} />
          <Text variant="caption" weight="semibold" tone="danger">
            Withdraw offer
          </Text>
        </Pressable>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 14, marginTop: spacing.lg, marginBottom: spacing.md },
  list: { gap: spacing.md },
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  amounts: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md },
  withdraw: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 36 },
  error: { marginBottom: spacing.md },
  counterWrap: { marginBottom: spacing.md },
});
