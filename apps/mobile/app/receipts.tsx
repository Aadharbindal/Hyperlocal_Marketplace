import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { formatInr } from '@hyperlocal/core';
import { useInvoices } from '@/api/growth';
import { palette, spacing } from '@/theme';
import { Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

/** Every bill this customer holds, newest first. */
export default function ReceiptsScreen() {
  const router = useRouter();
  const invoices = useInvoices();

  return (
    <Screen refreshing={invoices.isRefetching} onRefresh={() => void invoices.refetch()}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold">
          Receipts
        </Text>
      </View>
      <Spacer h={spacing.lg} />

      {invoices.isPending ? (
        <View style={styles.list}>
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      ) : invoices.isError ? (
        <ErrorState title="Could not load your receipts" body="Check your connection and try again." onRetry={() => void invoices.refetch()} />
      ) : invoices.data.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No receipts yet"
          body="A receipt appears here as soon as a booking is paid for."
        />
      ) : (
        <View style={styles.list}>
          {invoices.data.map((i, idx) => (
            <Animated.View key={i.id} entering={FadeInDown.delay(Math.min(idx, 8) * 40).duration(300)}>
              <Pressable onPress={() => router.push(`/invoice/${i.jobId}`)} accessibilityRole="button">
                <Card style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="label" weight="semibold">
                      {i.categoryName}
                    </Text>
                    <Text variant="micro" tone="muted">
                      {i.providerName} · {new Date(i.issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Text>
                    <Text variant="micro" tone="muted">
                      {i.number}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text variant="label" weight="bold">
                      {formatInr(i.netPaise)}
                    </Text>
                    {i.refundedPaise > 0 ? (
                      <Text variant="micro" style={{ color: palette.primary }}>
                        {formatInr(i.refundedPaise)} refunded
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
                </Card>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
