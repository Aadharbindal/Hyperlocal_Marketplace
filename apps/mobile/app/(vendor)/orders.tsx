import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { formatInr, type MaterialOrderView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useMoveMaterialOrder, useVendorOrders } from '@/api/materials';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

const STATUS: Record<string, { label: string; tone: 'primary' | 'success' | 'warning' | 'danger' | 'neutral' }> = {
  PENDING_PAYMENT: { label: 'awaiting payment', tone: 'neutral' },
  PREPARING: { label: 'to pack', tone: 'primary' },
  OUT_FOR_DELIVERY: { label: 'out for delivery', tone: 'warning' },
  DELIVERED: { label: 'awaiting confirmation', tone: 'warning' },
  CONFIRMED: { label: 'confirmed', tone: 'success' },
  ON_HOLD: { label: 'on hold', tone: 'danger' },
  CANCELLED: { label: 'cancelled', tone: 'neutral' },
};

export default function VendorOrdersScreen() {
  const orders = useVendorOrders();
  const live = orders.data?.items.filter((o) => o.status !== 'CONFIRMED' && o.status !== 'CANCELLED') ?? [];
  const done = orders.data?.items.filter((o) => o.status === 'CONFIRMED' || o.status === 'CANCELLED') ?? [];

  return (
    <Screen withTabBar refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()}>
      <Text variant="title" weight="bold">
        Orders
      </Text>
      <Spacer h={spacing.lg} />

      {orders.isPending ? (
        <Card style={styles.card}>
          <Skeleton height={16} width="45%" />
          <Skeleton height={54} />
        </Card>
      ) : orders.isError ? (
        <ErrorState title="Could not load orders" body="Check your connection and try again." onRetry={() => void orders.refetch()} />
      ) : orders.data.items.length === 0 ? (
        <EmptyState icon="cube-outline" title="No orders yet" body="Prices you send that get picked will appear here." />
      ) : (
        <>
          {live.length > 0 && (
            <View style={styles.list}>
              {live.map((o, i) => (
                <Animated.View key={o.id} entering={FadeInDown.delay(i * 60).duration(340)}>
                  <OrderCard order={o} />
                </Animated.View>
              ))}
            </View>
          )}
          {done.length > 0 && (
            <>
              <Text weight="semibold" style={styles.section}>
                Past orders
              </Text>
              <View style={styles.list}>
                {done.map((o) => (
                  <OrderCard key={o.id} order={o} />
                ))}
              </View>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function OrderCard({ order }: { order: MaterialOrderView }) {
  const move = useMoveMaterialOrder();
  const [error, setError] = useState<string | null>(null);
  const meta = STATUS[order.status] ?? { label: order.status.toLowerCase(), tone: 'neutral' as const };

  async function go(to: 'OUT_FOR_DELIVERY' | 'DELIVERED') {
    setError(null);
    try {
      await move.mutateAsync({ orderId: order.id, to });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update the order.');
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text variant="label" weight="semibold">
            {formatInr(order.totalPaise)}
          </Text>
          <Text variant="micro" tone="muted">
            {order.items.length} item{order.items.length > 1 ? 's' : ''} · deliver in {order.etaMinutes} min
          </Text>
        </View>
        <Badge tone={meta.tone} label={meta.label} />
      </View>

      <View style={styles.items}>
        {order.items.map((i, idx) => (
          <View key={`${i.name}-${idx}`} style={styles.itemRow}>
            <Text variant="micro" tone="secondary">
              {i.name}
              {i.brand ? ` · ${i.brand}` : ''} × {i.quantity}
            </Text>
            <Text variant="micro" weight="medium">
              {formatInr(i.linePaise ?? 0)}
            </Text>
          </View>
        ))}
      </View>

      {order.status === 'PENDING_PAYMENT' && (
        <View style={styles.note}>
          <Ionicons name="time-outline" size={14} color={palette.textMuted} />
          <Text variant="micro" tone="muted" style={{ flex: 1 }}>
            Do not pack yet — we will tell you the moment the payment is authorized.
          </Text>
        </View>
      )}

      {order.issue && (
        <View style={styles.note}>
          <Ionicons name="alert-circle" size={14} color={palette.danger} />
          <Text variant="micro" style={{ color: palette.danger, flex: 1 }}>
            {order.issue.toLowerCase().replace('_', ' ')}: {order.issueNote ?? 'reported by the customer'}
          </Text>
        </View>
      )}

      {error && (
        <Text variant="caption" style={{ color: palette.danger }}>
          {error}
        </Text>
      )}

      {order.status === 'PREPARING' && <Button title="Out for delivery" size="sm" fullWidth icon="bicycle-outline" loading={move.isPending} onPress={() => go('OUT_FOR_DELIVERY')} />}
      {order.status === 'OUT_FOR_DELIVERY' && <Button title="Mark delivered" size="sm" fullWidth icon="checkmark" loading={move.isPending} onPress={() => go('DELIVERED')} />}
      {order.status === 'CONFIRMED' && !order.invoiceNumber && (
        <View style={styles.note}>
          <Ionicons name="document-text-outline" size={14} color={palette.textMuted} />
          <Text variant="micro" tone="muted" style={{ flex: 1 }}>
            Upload your invoice for {formatInr(order.totalPaise)} to be paid for this order.
          </Text>
        </View>
      )}
      {order.invoiceNumber && <Badge tone="success" icon="document-text-outline" label={`Invoice ${order.invoiceNumber}`} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  section: { fontSize: 14, marginTop: spacing.lg, marginBottom: spacing.md },
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  items: { backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md, gap: 5 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
