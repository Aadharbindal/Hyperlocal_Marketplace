import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { formatInr, type VendorRequestView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useSendMaterialQuote, useVendorRequests } from '@/api/materials';
import { palette, radius, spacing, typography } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

const BLOCKER_COPY: Record<string, { title: string; body: string }> = {
  no_vendor_profile: { title: 'Finish your shop profile', body: 'Add your shop so nearby jobs can reach you.' },
  verification_pending: { title: 'Verification pending', body: 'Your shop has to be verified before you can quote.' },
  deliveries_paused: { title: 'Deliveries paused', body: 'Turn deliveries back on in the Shop tab to see requests.' },
};

export default function VendorRequestsScreen() {
  const feed = useVendorRequests();
  const [quoting, setQuoting] = useState<VendorRequestView | null>(null);

  return (
    <Screen withTabBar refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()}>
      <Text variant="title" weight="bold">
        Material requests
      </Text>
      <Text variant="caption" tone="secondary">
        Jobs near you that need supplies right now.
      </Text>
      <Spacer h={spacing.lg} />

      {feed.isPending ? (
        <View style={styles.list}>
          {[0, 1].map((i) => (
            <Card key={i} style={styles.card}>
              <Skeleton height={16} width="50%" />
              <Skeleton height={48} />
            </Card>
          ))}
        </View>
      ) : feed.isError ? (
        <ErrorState title="Could not load requests" body="Check your connection and try again." onRetry={() => void feed.refetch()} />
      ) : feed.data.blockers.length > 0 ? (
        <Card style={styles.card}>
          <Text weight="semibold">{BLOCKER_COPY[feed.data.blockers[0] ?? '']?.title ?? 'Not receiving requests'}</Text>
          <Text variant="caption" tone="secondary">
            {BLOCKER_COPY[feed.data.blockers[0] ?? '']?.body ?? 'Your shop cannot receive requests yet.'}
          </Text>
        </Card>
      ) : feed.data.items.length === 0 ? (
        <EmptyState icon="list-outline" title="No requests right now" body="You will see material lists from nearby jobs here." />
      ) : (
        <View style={styles.list}>
          {feed.data.items.map((r, i) => (
            <Animated.View key={r.id} entering={FadeInDown.delay(i * 60).duration(340)}>
              <RequestCard request={r} onQuote={() => setQuoting(r)} />
            </Animated.View>
          ))}
        </View>
      )}

      <QuoteSheet request={quoting} onClose={() => setQuoting(null)} />
    </Screen>
  );
}

function RequestCard({ request, onQuote }: { request: VendorRequestView; onQuote: () => void }) {
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Ionicons name="construct-outline" size={18} color={palette.primaryDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="label" weight="semibold">
            {request.items.length} item{request.items.length > 1 ? 's' : ''} needed
          </Text>
          <Text variant="micro" tone="muted">
            {request.areaLabel} · {request.distanceKm} km away
          </Text>
        </View>
        {request.alreadyQuoted && <Badge tone="neutral" label="quoted" />}
      </View>

      <View style={styles.items}>
        {request.items.map((i, idx) => (
          <View key={`${i.name}-${idx}`} style={styles.itemRow}>
            <Text variant="caption" tone="secondary">
              {i.name}
              {i.brand ? ` · ${i.brand}` : ''}
            </Text>
            <Text variant="caption" weight="medium">
              {i.quantity} {i.unit.toLowerCase()}
            </Text>
          </View>
        ))}
      </View>

      {request.note ? (
        <Text variant="caption" tone="secondary">
          “{request.note}”
        </Text>
      ) : null}

      {!request.alreadyQuoted && <Button title="Send a price" size="sm" fullWidth icon="pricetag-outline" onPress={onQuote} />}
    </Card>
  );
}

/** One price per line, with a stock switch - an out-of-stock line is never charged for. */
function QuoteSheet({ request, onClose }: { request: VendorRequestView | null; onClose: () => void }) {
  const send = useSendMaterialQuote();
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [stock, setStock] = useState<Record<number, boolean>>({});
  const [delivery, setDelivery] = useState('');
  const [eta, setEta] = useState('45');
  const [error, setError] = useState<string | null>(null);

  const subtotal = useMemo(() => {
    if (!request) return 0;
    return request.items.reduce((sum, item, idx) => {
      if (stock[idx] === false) return sum;
      return sum + Math.round(Number(prices[idx] || 0) * 100 * item.quantity);
    }, 0);
  }, [request, prices, stock]);
  const total = subtotal + Math.round(Number(delivery || 0) * 100);

  if (!request) return null;

  async function submit() {
    if (!request) return;
    setError(null);
    try {
      await send.mutateAsync({
        requestId: request.id,
        items: request.items.map((item, idx) => ({
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          unitPricePaise: Math.round(Number(prices[idx] || 0) * 100),
          inStock: stock[idx] !== false,
        })),
        deliveryPaise: Math.round(Number(delivery || 0) * 100),
        etaMinutes: Number(eta || 45),
      });
      setPrices({});
      setStock({});
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? quoteError(e) : 'Could not send the price.');
    }
  }

  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.sheetWrap}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <Animated.View entering={FadeInDown.duration(260)} style={styles.sheet}>
        <View style={styles.grabber} />
        <Text weight="bold" style={styles.sheetTitle}>
          Your price
        </Text>

        {request.items.map((item, idx) => (
          <View key={`${item.name}-${idx}`} style={styles.priceRow}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" weight="medium">
                {item.name}
              </Text>
              <Text variant="micro" tone="muted">
                {item.quantity} {item.unit.toLowerCase()}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setStock((s) => ({ ...s, [idx]: s[idx] === false }))}
              style={[styles.stockChip, stock[idx] === false && styles.stockOff]}
            >
              <Text variant="micro" weight="semibold" style={{ color: stock[idx] === false ? palette.danger : palette.primaryDeep }}>
                {stock[idx] === false ? 'Out of stock' : 'In stock'}
              </Text>
            </Pressable>
            <TextInput
              value={prices[idx] ?? ''}
              onChangeText={(v) => setPrices((p) => ({ ...p, [idx]: v.replace(/\D/g, '').slice(0, 6) }))}
              editable={stock[idx] !== false}
              keyboardType="number-pad"
              placeholder="₹ / unit"
              placeholderTextColor="#A9B8B1"
              style={styles.priceInput}
              accessibilityLabel={`Price for ${item.name}`}
            />
          </View>
        ))}

        <View style={styles.priceRow}>
          <Text variant="caption" style={{ flex: 1 }}>
            Delivery charge
          </Text>
          <TextInput
            value={delivery}
            onChangeText={(v) => setDelivery(v.replace(/\D/g, '').slice(0, 5))}
            keyboardType="number-pad"
            placeholder="₹ 0"
            placeholderTextColor="#A9B8B1"
            style={styles.priceInput}
            accessibilityLabel="Delivery charge"
          />
        </View>
        <View style={styles.priceRow}>
          <Text variant="caption" style={{ flex: 1 }}>
            Can deliver in (minutes)
          </Text>
          <TextInput
            value={eta}
            onChangeText={(v) => setEta(v.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            style={styles.priceInput}
            accessibilityLabel="Delivery time in minutes"
          />
        </View>

        <View style={styles.totalRow}>
          <Text weight="semibold">Customer pays</Text>
          <Text weight="bold" style={{ fontSize: 18 }}>
            {formatInr(total)}
          </Text>
        </View>
        <Text variant="micro" tone="muted">
          You receive the full amount — the platform takes no cut on materials.
        </Text>

        {error && (
          <Text variant="caption" style={{ color: palette.danger }}>
            {error}
          </Text>
        )}

        <Button title="Send price" fullWidth loading={send.isPending} onPress={submit} />
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
          <Text variant="caption" weight="semibold" tone="muted">
            Not now
          </Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function quoteError(e: ApiError): string {
  const first = (e.details as { materials?: string[] } | undefined)?.materials?.[0];
  switch (first) {
    case 'WINDOW_CLOSED':
      return 'This request has closed.';
    case 'ALREADY_QUOTED':
      return 'You have already sent a price for this list.';
    case 'NOTHING_IN_STOCK':
      return 'Mark at least one item as in stock.';
    case 'VENDOR_NOT_VERIFIED':
      return 'Your shop is not verified yet.';
    case 'VENDOR_UNAVAILABLE':
      return 'Turn deliveries on in the Shop tab first.';
    default:
      return e.message;
  }
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  items: { backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md, gap: 5 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },

  sheetWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: palette.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.lg,
    gap: spacing.sm,
    maxHeight: '88%',
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: palette.border, marginBottom: spacing.sm },
  sheetTitle: { fontSize: 18, color: palette.text },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stockChip: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: palette.primarySoft },
  stockOff: { backgroundColor: '#FDE7E7' },
  priceInput: {
    width: 86,
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#E4EDE9',
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
    fontSize: 15,
    fontFamily: typography.family.medium,
    color: palette.text,
  },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  cancel: { alignItems: 'center', minHeight: 40, justifyContent: 'center' },
});
