import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { formatInr } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useAdminSettlements, useMfaStatus, useOpsReport, useRetrySettlement, useRunSettlements } from '@/api/admin';
import { useLogout } from '@/api/hooks';
import { JobLedgerPanel } from '@/features/admin/JobLedgerPanel';
import { MfaGate } from '@/features/admin/MfaGate';
import { palette, spacing } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, StatTile, Text } from '@/ui';

export default function MoneyScreen() {
  const mfa = useMfaStatus();
  const unlocked = !!mfa.data && (mfa.data.verifiedForSession || !mfa.data.requiredForAdmin);
  const report = useOpsReport(unlocked);
  const pending = useAdminSettlements('PENDING', unlocked);
  const held = useAdminSettlements('ON_HOLD', unlocked);
  const run = useRunSettlements();
  const retry = useRetrySettlement();
  const logout = useLogout();
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);

  async function runPayouts() {
    setError(null);
    try {
      const res = await run.mutateAsync();
      const paid = res.results.filter((r) => r.status === 'PAID').length;
      setLastRun(`${paid} paid, ${res.results.length - paid} still waiting`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not run payouts.');
    }
  }

  return (
    <Screen withTabBar refreshing={report.isRefetching} onRefresh={() => void report.refetch()}>
      <Text variant="title" weight="bold">
        Money
      </Text>
      <Spacer h={spacing.lg} />

      <MfaGate>
        {report.isPending ? (
          <Card style={styles.card}>
            <Skeleton height={18} width="40%" />
            <Skeleton height={80} />
          </Card>
        ) : report.isError ? (
          <ErrorState title="Could not load the report" body="Check your connection and try again." onRetry={() => void report.refetch()} />
        ) : (
          <>
            <Card style={styles.card}>
              <Text weight="semibold">Today</Text>
              <View style={styles.grid}>
                <View style={styles.statCell}>
                  <StatTile label="Live jobs" value={String(report.data.liveJobs)} />
                </View>
                <View style={styles.statCell}>
                  <StatTile label="Completed" value={String(report.data.completedJobs)} />
                </View>
                <View style={styles.statCell}>
                  <StatTile label="Charged" value={formatInr(report.data.capturedPaise)} />
                </View>
                <View style={styles.statCell}>
                  <StatTile label="Refunded" value={formatInr(report.data.refundedPaise)} />
                </View>
                <View style={styles.statCell}>
                  <StatTile label="Platform fee" value={formatInr(report.data.platformRevenuePaise)} />
                </View>
                <View style={styles.statCell}>
                  <StatTile label="To pay out" value={formatInr(report.data.payoutsPendingPaise)} />
                </View>
              </View>
              <View style={styles.grid}>
                <View style={styles.statCell}>
                  <StatTile label="Disputes open" value={String(report.data.disputesOpen)} tone={report.data.disputesOpen > 0 ? 'danger' : 'default'} />
                </View>
                <View style={styles.statCell}>
                  <StatTile label="Past SLA" value={String(report.data.disputesBreachingSla)} tone={report.data.disputesBreachingSla > 0 ? 'danger' : 'default'} />
                </View>
                <View style={styles.statCell}>
                  <StatTile label="KYC waiting" value={String(report.data.kycPending)} />
                </View>
              </View>
            </Card>

            <Spacer h={spacing.md} />
            <Card style={styles.card}>
              <View style={styles.head}>
                <View style={{ flex: 1 }}>
                  <Text weight="semibold">Payout run</Text>
                  <Text variant="micro" tone="muted">
                    Nothing is sent before 24 h after capture, or while a dispute is open.
                  </Text>
                </View>
                <Badge tone="neutral" label={`${pending.data?.items.length ?? 0} queued`} />
              </View>

              {lastRun && (
                <View style={styles.note}>
                  <Ionicons name="checkmark-circle-outline" size={14} color={palette.primaryDeep} />
                  <Text variant="micro" tone="muted" style={{ flex: 1 }}>
                    Last run: {lastRun}
                  </Text>
                </View>
              )}
              {error && (
                <Text variant="caption" style={{ color: palette.danger }}>
                  {error}
                </Text>
              )}
              <Button title="Run payouts" fullWidth icon="send-outline" loading={run.isPending} onPress={runPayouts} />
              <Text variant="micro" tone="muted">
                There is no scheduler yet, so this is run by hand. Every guard is re-checked per
                payout, so running it twice is safe.
              </Text>
            </Card>

            {(held.data?.items.length ?? 0) > 0 && (
              <>
                <Text weight="semibold" style={styles.section}>
                  Held payouts
                </Text>
                <View style={styles.list}>
                  {held.data!.items.map((s, i) => (
                    <Animated.View key={s.id} entering={FadeInDown.delay(i * 50).duration(300)}>
                      <Card style={styles.row}>
                        <View style={{ flex: 1 }}>
                          <Text variant="label" weight="semibold">
                            {formatInr(s.amountPaise)}
                          </Text>
                          <Text variant="micro" tone="muted">
                            {s.payeeRole.toLowerCase()} · {s.failureReason ?? 'on hold'} · {s.attempts} attempt{s.attempts === 1 ? '' : 's'}
                          </Text>
                        </View>
                        <Button title="Retry" size="sm" variant="secondary" loading={retry.isPending} onPress={() => retry.mutate(s.id)} />
                      </Card>
                    </Animated.View>
                  ))}
                </View>
              </>
            )}

            {(pending.data?.items.length ?? 0) === 0 && (held.data?.items.length ?? 0) === 0 && (
              <>
                <Spacer h={spacing.md} />
                <EmptyState icon="cash-outline" title="Nothing owed" body="Every settled job has been paid out." />
              </>
            )}
          </>
        )}

        {/* Answering "where did my money go?" used to mean a database session. Behind the same
            MFA gate as everything else on this screen, because it can move money back. */}
        <Spacer h={spacing.xxl} />
        <JobLedgerPanel unlocked={unlocked} />
      </MfaGate>

      <Spacer h={spacing.xl} />
      <Button title="Sign out" variant="ghost" fullWidth onPress={() => void logout.mutateAsync()} />
    </Screen>
  );
}


const styles = StyleSheet.create({
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  /* The tiles carry their own sunken fill now, so the grid is only a layout - a second background
     behind them read as a box inside a box. */
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCell: { width: '31%' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  section: { fontSize: 14, marginTop: spacing.lg, marginBottom: spacing.md },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
