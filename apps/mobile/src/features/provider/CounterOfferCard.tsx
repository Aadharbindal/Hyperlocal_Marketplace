import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { formatInr, type OfferChainItem } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useRespondToOffer } from '@/api/negotiation';
import { palette, radius, spacing } from '@/theme';
import { Button, Card, Text } from '@/ui';

/**
 * A counter-offer waiting on the provider. Accepting locks the customer's price; countering
 * back sends one more round.
 */
export function CounterOfferCard({ jobId, offer, currentPaise, categoryName }: { jobId: string; offer: OfferChainItem; currentPaise: number; categoryName: string }) {
  const respond = useRespondToOffer();
  const [error, setError] = useState<string | null>(null);

  const offered = offer.labourPaise + offer.visitFeePaise;
  const difference = currentPaise - offered;

  async function act(action: 'ACCEPT' | 'REJECT' | 'COUNTER') {
    setError(null);
    try {
      await respond.mutateAsync({
        jobId,
        offerId: offer.id,
        action,
        // Meeting in the middle is the common case, so that is what the button offers.
        ...(action === 'COUNTER' ? { labourPaise: Math.round((offer.labourPaise + currentPaise) / 2) } : {}),
      });
    } catch (e) {
      setError(e instanceof ApiError ? respondError(e) : 'Something went wrong.');
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Ionicons name="swap-horizontal" size={18} color={palette.primaryDeep} />
        </View>
        <View style={styles.headText}>
          <Text variant="label" weight="semibold">
            Customer countered
          </Text>
          <Text variant="micro" tone="muted">
            {categoryName} · expires {new Date(offer.expiresAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
          </Text>
        </View>
      </View>

      <View style={styles.amounts}>
        <View>
          <Text variant="micro" tone="muted">
            You asked
          </Text>
          <Text variant="label" weight="semibold" style={styles.struck}>
            {formatInr(currentPaise)}
          </Text>
        </View>
        <Ionicons name="arrow-forward" size={16} color={palette.textMuted} />
        <View>
          <Text variant="micro" tone="muted">
            They offer
          </Text>
          <Text variant="subheading" weight="bold" tone="primary">
            {formatInr(offered)}
          </Text>
        </View>
        {difference > 0 && (
          <View style={styles.diff}>
            <Text variant="micro" weight="semibold" tone="danger">
              −{formatInr(difference)}
            </Text>
          </View>
        )}
      </View>

      {offer.scopeNotes ? (
        <Text variant="caption" tone="secondary">
          “{offer.scopeNotes}”
        </Text>
      ) : null}

      {error && (
        <Animated.View entering={FadeIn.duration(200)} style={styles.errorRow}>
          <Ionicons name="alert-circle" size={15} color={palette.danger} />
          <Text variant="caption" style={{ color: palette.danger, flex: 1 }}>
            {error}
          </Text>
        </Animated.View>
      )}

      <View style={styles.actions}>
        <Button title="Decline" size="sm" variant="ghost" style={styles.action} loading={respond.isPending} onPress={() => act('REJECT')} />
        <Button title="Meet halfway" size="sm" variant="secondary" style={styles.action} loading={respond.isPending} onPress={() => act('COUNTER')} />
        <Button title="Accept" size="sm" style={styles.action} loading={respond.isPending} onPress={() => act('ACCEPT')} />
      </View>
    </Card>
  );
}

function respondError(e: ApiError): string {
  const first = (e.details as { negotiation?: string[] } | undefined)?.negotiation?.[0];
  switch (first) {
    case 'OFFER_EXPIRED':
      return 'This counter-offer has expired.';
    case 'OFFER_NOT_PENDING':
      return 'This counter-offer was already answered.';
    case 'ROUND_LIMIT_REACHED':
      return 'You have gone back and forth enough times on this job.';
    case 'JOB_NOT_NEGOTIABLE':
      return 'This job is no longer open for negotiation.';
    case 'BID_NOT_ACTIVE':
      return 'Your offer on this job is no longer live.';
    default:
      return e.message;
  }
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, borderWidth: 2, borderColor: palette.primary },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, gap: 2 },
  amounts: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md },
  struck: { textDecorationLine: 'line-through', color: palette.textMuted },
  diff: { marginLeft: 'auto' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
