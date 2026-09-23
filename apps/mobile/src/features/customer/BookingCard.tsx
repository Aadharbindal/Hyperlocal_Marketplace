import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { formatInr } from '@hyperlocal/core';
import { useBooking, useCompleteMockPayment } from '@/api/negotiation';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, Text } from '@/ui';

/**
 * The confirmed booking: who is coming, the locked price and what is still owed. Shown once a
 * quote exists, so it covers PAYMENT_PENDING through to completion.
 */
export function BookingCard({ jobId, enabled }: { jobId: string; enabled: boolean }) {
  const booking = useBooking(jobId, enabled);
  const pay = useCompleteMockPayment();

  const quote = booking.data?.quote;
  const assignment = booking.data?.assignment;
  if (!quote || !assignment) return null;

  const pending = booking.data?.payments.find((p) => p.status === 'PENDING');
  const authorized = booking.data?.payments.find((p) => p.status === 'AUTHORIZED' || p.status === 'CAPTURED');

  return (
    <Animated.View entering={FadeInDown.duration(360)}>
      <Card style={styles.card}>
        <View style={styles.head}>
          <View style={styles.avatar}>
            <Text weight="bold" tone="primary">
              {(quote.providerBusinessName ?? '?').slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={styles.headText}>
            <View style={styles.nameRow}>
              <Text variant="label" weight="semibold" numberOfLines={1}>
                {quote.providerBusinessName ?? 'Your provider'}
              </Text>
              {assignment.providerVerified && <Ionicons name="shield-checkmark" size={15} color={palette.primary} />}
            </View>
            <Text variant="micro" tone="muted">
              {assignment.technicianName ? `Technician: ${assignment.technicianName}` : 'Booked business'}
            </Text>
          </View>
          <Badge tone={authorized ? 'success' : 'warning'} label={authorized ? 'Confirmed' : 'Payment due'} />
        </View>

        {/* the locked price - this cannot move without an approved revision */}
        <View style={styles.breakdown}>
          <Row label="Labour" value={formatInr(quote.labourPaise)} />
          {quote.visitFeePaise > 0 && <Row label="Visit fee" value={formatInr(quote.visitFeePaise)} />}
          <Row label="Platform fee + tax" value={formatInr(quote.platformFeePaise + quote.taxPaise)} muted />
          <View style={styles.divider} />
          <Row label={authorized ? 'Authorized' : 'To authorize'} value={formatInr(quote.totalPaise)} bold />
        </View>

        <View style={styles.tags}>
          <Badge tone="neutral" icon="lock-closed" label="Price locked" />
          {quote.warrantyDays > 0 && <Badge tone="success" icon="shield-outline" label={`${quote.warrantyDays} day warranty`} />}
          {quote.materialResponsibility === 'PROVIDER' && <Badge tone="info" label="Brings materials" />}
        </View>

        {pending ? (
          <>
            <Button
              title={`Authorize ${formatInr(pending.amountPaise)}`}
              size="md"
              fullWidth
              icon="lock-closed"
              loading={pay.isPending}
              onPress={() => pay.mutate({ jobId, paymentId: pending.id, outcome: 'authorized' })}
            />
            <Text variant="micro" tone="muted" center>
              Money is only released after you approve the finished work.
            </Text>
          </>
        ) : (
          <View style={styles.assurance}>
            <Ionicons name="information-circle-outline" size={14} color={palette.textMuted} />
            <Text variant="micro" tone="muted" style={{ flex: 1 }}>
              Extra work needs your approval before anything is added to this price.
            </Text>
          </View>
        )}
      </Card>
    </Animated.View>
  );
}

function Row({ label, value, muted, bold }: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant="caption" tone={muted ? 'muted' : 'secondary'}>
        {label}
      </Text>
      <Text variant={bold ? 'label' : 'caption'} weight={bold ? 'bold' : 'medium'} tone={muted ? 'muted' : 'default'}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.lg, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  breakdown: { backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  assurance: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
