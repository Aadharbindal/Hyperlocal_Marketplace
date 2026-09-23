import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { formatInr, type JobStatus, type MaterialOrderView, type MaterialQuoteView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useCompleteMockPayment } from '@/api/negotiation';
import { useConfirmDelivery, useMaterials, useSelectMaterialQuote } from '@/api/materials';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, Text } from '@/ui';

const LIVE: JobStatus[] = ['ARRIVED', 'STARTED', 'IN_PROGRESS', 'PRICE_REVISION_PENDING', 'COMPLETION_PENDING', 'CUSTOMER_APPROVAL_PENDING'];

const ORDER_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Authorize to order',
  PREPARING: 'Supplier is packing',
  OUT_FOR_DELIVERY: 'On the way',
  DELIVERED: 'Delivered — please check',
  CONFIRMED: 'Received',
  ON_HOLD: 'Problem reported',
  CANCELLED: 'Cancelled',
};

/**
 * The material leg as the customer sees it: what the technician asked for, what local
 * suppliers will charge, and where the delivery is. Material money is always separate from
 * the labour hold.
 */
export function MaterialPanel({ jobId, status }: { jobId: string; status: JobStatus }) {
  const enabled = LIVE.includes(status);
  const panel = useMaterials(jobId, enabled);
  if (!enabled || !panel.data) return null;
  const { request, quotes, order } = panel.data;
  if (!request && !order) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Ionicons name="cube-outline" size={17} color={palette.primaryDeep} />
        <Text weight="bold" style={styles.title}>
          Materials
        </Text>
      </View>

      {order ? (
        <OrderCard jobId={jobId} order={order} />
      ) : request ? (
        <>
          <Card style={styles.listCard}>
            <Text variant="caption" tone="secondary">
              Your technician asked for:
            </Text>
            {request.items.map((i, idx) => (
              <View key={`${i.name}-${idx}`} style={styles.itemRow}>
                <Text variant="caption">{i.name}</Text>
                <Text variant="caption" tone="muted">
                  {i.quantity} {i.unit.toLowerCase()}
                </Text>
              </View>
            ))}
            {request.note ? (
              <Text variant="micro" tone="muted">
                “{request.note}”
              </Text>
            ) : null}
            <Text variant="micro" tone="muted">
              {quotes.length === 0
                ? 'Waiting for prices from nearby suppliers. Nothing is bought until you pick one.'
                : `${quotes.length} supplier${quotes.length > 1 ? 's' : ''} answered — best match first.`}
            </Text>
          </Card>

          {quotes.map((q, i) => (
            <Animated.View key={q.id} entering={FadeInDown.delay(i * 70).duration(320)}>
              <QuoteCard jobId={jobId} quote={q} best={i === 0} />
            </Animated.View>
          ))}
        </>
      ) : null}
    </View>
  );
}

function QuoteCard({ jobId, quote, best }: { jobId: string; quote: MaterialQuoteView; best: boolean }) {
  const select = useSelectMaterialQuote();
  const [error, setError] = useState<string | null>(null);
  const partial = quote.inStockCount < quote.itemCount;

  async function choose() {
    setError(null);
    try {
      await select.mutateAsync({ jobId, quoteId: quote.id });
    } catch (e) {
      setError(e instanceof ApiError ? selectError(e) : 'Something went wrong.');
    }
  }

  return (
    <Card style={[styles.quote, best && styles.quoteBest]}>
      <View style={styles.quoteHead}>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text variant="label" weight="semibold" numberOfLines={1}>
              {quote.vendor.shopName}
            </Text>
            {quote.vendor.verified && <Ionicons name="shield-checkmark" size={14} color={palette.primary} />}
          </View>
          <Text variant="micro" tone="muted">
            {quote.vendor.distanceKm} km · arrives in {quote.etaMinutes} min
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="subheading" weight="bold">
            {formatInr(quote.totalPaise)}
          </Text>
          <Text variant="micro" tone="muted">
            delivered
          </Text>
        </View>
      </View>

      <View style={styles.breakdown}>
        {quote.items.map((i, idx) => (
          <View key={`${i.name}-${idx}`} style={styles.itemRow}>
            <Text variant="micro" tone={i.inStock === false ? 'muted' : 'secondary'} style={i.inStock === false ? styles.struck : undefined}>
              {i.name}
              {i.brand ? ` · ${i.brand}` : ''} × {i.quantity}
            </Text>
            <Text variant="micro" weight="medium" tone={i.inStock === false ? 'muted' : 'default'}>
              {i.inStock === false ? 'out of stock' : formatInr(i.linePaise ?? 0)}
            </Text>
          </View>
        ))}
        <View style={styles.divider} />
        <View style={styles.itemRow}>
          <Text variant="micro" tone="muted">
            Delivery
          </Text>
          <Text variant="micro" weight="medium">
            {quote.deliveryPaise === 0 ? 'Free' : formatInr(quote.deliveryPaise)}
          </Text>
        </View>
      </View>

      {partial && <Badge tone="warning" icon="alert-circle-outline" label={`${quote.itemCount - quote.inStockCount} item not available`} />}
      {error && (
        <Animated.View entering={FadeIn.duration(180)}>
          <Text variant="caption" style={{ color: palette.danger }}>
            {error}
          </Text>
        </Animated.View>
      )}

      <Button title={`Order for ${formatInr(quote.totalPaise)}`} size="sm" fullWidth loading={select.isPending} onPress={choose} />
      <Text variant="micro" tone="muted" center>
        Charged separately from the work — your job price does not change.
      </Text>
    </Card>
  );
}

function OrderCard({ jobId, order }: { jobId: string; order: MaterialOrderView }) {
  const pay = useCompleteMockPayment();
  const confirm = useConfirmDelivery();
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
  }

  const needsPayment = order.status === 'PENDING_PAYMENT' && order.payment && order.payment.status === 'PENDING';
  const needsConfirm = order.status === 'DELIVERED' || order.status === 'OUT_FOR_DELIVERY';

  return (
    <Card style={styles.quote}>
      <View style={styles.quoteHead}>
        <View style={{ flex: 1 }}>
          <Text variant="label" weight="semibold">
            {order.vendorShopName}
          </Text>
          <Text variant="micro" tone="muted">
            {ORDER_LABEL[order.status] ?? order.status}
          </Text>
        </View>
        <Badge tone={order.status === 'ON_HOLD' ? 'danger' : order.status === 'CONFIRMED' ? 'success' : 'primary'} label={formatInr(order.totalPaise)} />
      </View>

      <View style={styles.breakdown}>
        {order.items.map((i, idx) => (
          <View key={`${i.name}-${idx}`} style={styles.itemRow}>
            <Text variant="micro" tone="secondary">
              {i.name} × {i.quantity}
            </Text>
            <Text variant="micro" weight="medium">
              {formatInr(i.linePaise ?? 0)}
            </Text>
          </View>
        ))}
      </View>

      {order.issue && (
        <View style={styles.assurance}>
          <Ionicons name="alert-circle" size={14} color={palette.danger} />
          <Text variant="micro" style={{ color: palette.danger, flex: 1 }}>
            Reported: {order.issue.toLowerCase().replace('_', ' ')}. Support will sort this out; the supplier is not paid meanwhile.
          </Text>
        </View>
      )}

      {error && (
        <Text variant="caption" style={{ color: palette.danger }}>
          {error}
        </Text>
      )}

      {needsPayment && order.payment && (
        <Button
          title={`Authorize ${formatInr(order.payment.amountPaise)}`}
          size="sm"
          fullWidth
          icon="lock-closed"
          loading={pay.isPending}
          onPress={() => run(() => pay.mutateAsync({ jobId, paymentId: order.payment!.id, outcome: 'authorized' }))}
        />
      )}

      {needsConfirm && (
        <View style={styles.actions}>
          <Button
            title="Something's wrong"
            size="sm"
            variant="ghost"
            style={styles.action}
            loading={confirm.isPending}
            onPress={() => run(() => confirm.mutateAsync({ jobId, orderId: order.id, ok: false, issue: 'WRONG_ITEM', note: 'Reported from the app' }))}
          />
          <Button
            title="All received"
            size="sm"
            style={styles.action}
            loading={confirm.isPending}
            onPress={() => run(() => confirm.mutateAsync({ jobId, orderId: order.id, ok: true }))}
          />
        </View>
      )}
    </Card>
  );
}

function selectError(e: ApiError): string {
  const first = (e.details as { materials?: string[] } | undefined)?.materials?.[0];
  switch (first) {
    case 'QUOTE_EXPIRED':
      return 'This price has expired. Ask the supplier to send it again.';
    case 'ALREADY_ORDERED':
      return 'These materials are already ordered.';
    case 'QUOTE_NOT_ACTIVE':
      return 'This supplier has withdrawn the price.';
    case 'NOTHING_IN_STOCK':
      return 'Nothing on this quote is in stock any more.';
    default:
      return e.message;
  }
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 16 },
  listCard: { gap: spacing.sm },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  struck: { textDecorationLine: 'line-through' },

  quote: { gap: spacing.md },
  quoteBest: { borderWidth: 2, borderColor: palette.primary },
  quoteHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  breakdown: { backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md, gap: 5 },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 2 },
  assurance: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
