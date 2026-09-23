import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { formatInr, type OfferView } from '@hyperlocal/core';
import { useOffers } from '@/api/provider';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, Skeleton, Text } from '@/ui';

/**
 * The offers a customer has received, best match first. Accepting one lands in M4, so the
 * action is disabled here rather than pretending it works.
 */
export function OffersList({ jobId, live }: { jobId: string; live: boolean }) {
  const offers = useOffers(jobId, live);

  if (offers.isPending) {
    return (
      <Card style={styles.card}>
        <Skeleton height={16} width="40%" />
        <Skeleton height={64} />
      </Card>
    );
  }
  if (offers.isError || offers.data.items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text weight="bold" style={styles.title}>
          {offers.data.items.length} offer{offers.data.items.length > 1 ? 's' : ''} received
        </Text>
        <Text variant="micro" tone="muted">
          Best match first
        </Text>
      </View>

      {offers.data.items.map((o, i) => (
        <Animated.View key={o.id} entering={FadeInDown.delay(i * 70).duration(360)}>
          <OfferCard offer={o} best={i === 0} />
        </Animated.View>
      ))}
    </View>
  );
}

function OfferCard({ offer, best }: { offer: OfferView; best: boolean }) {
  const p = offer.provider;
  return (
    <Card style={[styles.card, best && styles.cardBest]}>
      {best && (
        <View style={styles.bestPill}>
          <Ionicons name="star" size={11} color="#8A6400" />
          <Text variant="micro" weight="bold" style={{ color: '#8A6400' }}>
            BEST MATCH
          </Text>
        </View>
      )}

      <View style={styles.providerRow}>
        <View style={styles.avatar}>
          <Text weight="bold" tone="primary">
            {p.businessName.slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={styles.providerText}>
          <View style={styles.nameRow}>
            <Text variant="label" weight="semibold" numberOfLines={1}>
              {p.businessName}
            </Text>
            {p.verified && <Ionicons name="shield-checkmark" size={15} color={palette.primary} />}
          </View>
          <Text variant="micro" tone="muted">
            {p.ratingAvg ? `${p.ratingAvg.toFixed(1)} ★ · ` : ''}
            {p.completedJobs} jobs · {p.distanceKm} km away
          </Text>
        </View>
        <View style={styles.price}>
          <Text variant="subheading" weight="bold">
            {formatInr(offer.totalPaise)}
          </Text>
          <Text variant="micro" tone="muted">
            all-in
          </Text>
        </View>
      </View>

      {/* transparent split, never a single opaque number */}
      <View style={styles.breakdown}>
        <Split label="Labour" value={formatInr(offer.labourPaise)} />
        {offer.visitFeePaise > 0 && <Split label="Visit fee" value={formatInr(offer.visitFeePaise)} />}
        <Split label="Platform fee + tax" value={formatInr(offer.platformFeePaise + offer.taxPaise)} />
      </View>

      <View style={styles.tags}>
        <Badge tone="neutral" icon="time-outline" label={offer.etaMinutes < 60 ? `${offer.etaMinutes} min` : `${Math.round(offer.etaMinutes / 60)} h`} />
        {offer.warrantyDays > 0 && <Badge tone="success" icon="shield-outline" label={`${offer.warrantyDays}d warranty`} />}
        {offer.materialResponsibility === 'PROVIDER' && <Badge tone="info" label="Brings materials" />}
        {offer.sponsored && <Badge tone="warning" label="Promoted" />}
      </View>

      {offer.notes ? (
        <Text variant="caption" tone="secondary">
          “{offer.notes}”
        </Text>
      ) : null}

      <Button title="Accepting offers opens soon" size="sm" variant="secondary" fullWidth disabled onPress={() => undefined} />
    </Card>
  );
}

function Split({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.splitRow}>
      <Text variant="micro" tone="muted">
        {label}
      </Text>
      <Text variant="micro" weight="medium">
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: 16 },
  card: { gap: spacing.md },
  cardBest: { borderWidth: 2, borderColor: palette.primary },
  bestPill: { position: 'absolute', top: -1, right: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FFE8B8', paddingHorizontal: spacing.sm, paddingVertical: 3, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm },

  providerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  providerText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  price: { alignItems: 'flex-end' },

  breakdown: { backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md, gap: 4 },
  splitRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
