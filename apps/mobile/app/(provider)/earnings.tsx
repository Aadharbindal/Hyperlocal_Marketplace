import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { formatInr, type SettlementView } from '@hyperlocal/core';
import { useEarnings } from '@/api/finance';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

const STATUS: Record<string, { label: string; tone: 'primary' | 'success' | 'warning' | 'danger' | 'neutral' }> = {
  PENDING: { label: 'clearing', tone: 'warning' },
  INITIATED: { label: 'sending', tone: 'primary' },
  PAID: { label: 'paid', tone: 'success' },
  FAILED: { label: 'retrying', tone: 'danger' },
  ON_HOLD: { label: 'on hold', tone: 'danger' },
};

export default function EarningsScreen() {
  const t = useStrings();
  const router = useRouter();
  const earnings = useEarnings();

  return (
    <Screen withTabBar refreshing={earnings.isRefetching} onRefresh={() => void earnings.refetch()}>
      <Text variant="title" weight="bold">
        {t('tabs.earnings')}
      </Text>
      <Spacer h={spacing.lg} />

      {earnings.isPending ? (
        <Card style={styles.card}>
          <Skeleton height={20} width="50%" />
          <Skeleton height={72} />
        </Card>
      ) : earnings.isError ? (
        <ErrorState title="Could not load earnings" body="Check your connection and try again." onRetry={() => void earnings.refetch()} />
      ) : (
        <>
          <Card style={styles.hero}>
            <Text variant="caption" tone="secondary">
              Paid to you so far
            </Text>
            <Text weight="extrabold" style={styles.big}>
              {formatInr(earnings.data.settledPaise)}
            </Text>
            <View style={styles.splitRow}>
              <Stat label="Clearing" value={formatInr(earnings.data.pendingPaise)} hint="Released 24 h after the customer approves" />
              {earnings.data.onHoldPaise > 0 && <Stat label="On hold" value={formatInr(earnings.data.onHoldPaise)} hint="Held while a dispute is open" danger />}
            </View>
          </Card>

          {/* Money that is earned and cleared but has nowhere to go is the one thing worth
              interrupting this screen for, so it sits above everything else. */}
          {!earnings.data.payoutAccount ? (
            <>
              <Spacer h={spacing.md} />
              <Card style={styles.callout}>
                <View style={styles.calloutRow}>
                  <Ionicons name="wallet-outline" size={20} color={palette.primary} />
                  <Text variant="label" weight="semibold" style={{ flex: 1 }}>
                    Tell us where to send your money
                  </Text>
                </View>
                <Text variant="micro" tone="muted">
                  {earnings.data.awaitingPayoutAccountPaise > 0
                    ? `${formatInr(earnings.data.awaitingPayoutAccountPaise)} is waiting for your bank or UPI details. It is held safely until you add them.`
                    : 'Add your bank or UPI details now so your first payout is not held up.'}
                </Text>
                <Button title="Add bank details" size="sm" onPress={() => router.push('/payout-account')} />
              </Card>
            </>
          ) : (
            <>
              <Spacer h={spacing.md} />
              <Pressable onPress={() => router.push('/payout-account')} accessibilityRole="button">
                <Card style={styles.row}>
                  <Ionicons name="wallet-outline" size={18} color={palette.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text variant="micro" tone="muted">
                      Paying into
                    </Text>
                    <Text variant="label" weight="semibold">
                      {earnings.data.payoutAccount.masked}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                </Card>
              </Pressable>
            </>
          )}

          <Spacer h={spacing.md} />
          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={14} color={palette.textMuted} />
            <Text variant="micro" tone="muted" style={{ flex: 1 }}>
              You are paid what the accepted quote said, minus nothing else. The platform fee was already
              shown to the customer at booking.
            </Text>
          </View>

          <Text weight="semibold" style={styles.section}>
            Payouts
          </Text>
          {earnings.data.settlements.length === 0 ? (
            <EmptyState icon="wallet-outline" title={t('earnings.empty.title')} body={t('earnings.empty.body')} />
          ) : (
            <View style={styles.list}>
              {earnings.data.settlements.map((s, i) => (
                <Animated.View key={s.id} entering={FadeInDown.delay(i * 50).duration(320)}>
                  <SettlementRow settlement={s} />
                </Animated.View>
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value, hint, danger }: { label: string; value: string; hint: string; danger?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text variant="micro" tone="muted">
        {label}
      </Text>
      <Text variant="label" weight="bold" style={danger ? { color: palette.danger } : undefined}>
        {value}
      </Text>
      <Text variant="micro" tone="muted">
        {hint}
      </Text>
    </View>
  );
}

function SettlementRow({ settlement }: { settlement: SettlementView }) {
  const meta = STATUS[settlement.status] ?? { label: settlement.status.toLowerCase(), tone: 'neutral' as const };
  return (
    <Card style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text variant="label" weight="semibold">
          {formatInr(settlement.amountPaise)}
        </Text>
        <Text variant="micro" tone="muted">
          {settlement.paidAt
            ? `Paid ${new Date(settlement.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
            : settlement.failureReason === 'NO_PAYOUT_ACCOUNT'
              ? 'Waiting for your bank details'
              : settlement.failureReason === 'dispute_open'
                ? 'Held while a dispute is open'
                : 'Clearing'}
        </Text>
      </View>
      <Badge tone={meta.tone} label={meta.label} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  hero: { gap: spacing.sm },
  big: { fontSize: 34, lineHeight: 42, color: palette.text, letterSpacing: -1 },
  splitRow: { flexDirection: 'row', gap: spacing.md, backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md },
  stat: { flex: 1, gap: 2 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  callout: { gap: spacing.sm, borderWidth: 1, borderColor: palette.primary },
  calloutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  section: { fontSize: 14, marginTop: spacing.lg, marginBottom: spacing.md },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
