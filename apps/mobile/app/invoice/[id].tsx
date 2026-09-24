import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { formatInr } from '@hyperlocal/core';
import { useInvoice } from '@/api/growth';
import { palette, radius, spacing } from '@/theme';
import { Button, Card, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

/**
 * The bill for one booking.
 *
 * Laid out the way a receipt is read rather than the way the data is stored: what the work
 * cost, then what we charged for arranging it, then tax - so nobody has to work out which part
 * of the total went where. A platform that hides its own fee inside a single number is a
 * platform somebody stops trusting the first time they do the arithmetic.
 */
export default function InvoiceScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoice = useInvoice(id);

  async function share() {
    if (!invoice.data) return;
    const i = invoice.data;
    await Share.share({
      message: [
        `Receipt ${i.number}`,
        `${i.categoryName} - ${i.providerName}`,
        new Date(i.issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
        '',
        `Total paid: ${formatInr(i.netPaise)}`,
      ].join('\n'),
    });
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold" style={{ flex: 1 }}>
          Receipt
        </Text>
        {invoice.data ? (
          <Pressable onPress={() => void share()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Share receipt">
            <Ionicons name="share-outline" size={22} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <Spacer h={spacing.lg} />

      {invoice.isPending ? (
        <Card style={{ gap: spacing.md }}>
          <Skeleton height={24} width="50%" />
          <Skeleton height={120} />
        </Card>
      ) : invoice.isError ? (
        <ErrorState
          title="No receipt yet"
          body="A receipt is issued once the booking is paid for."
          onRetry={() => void invoice.refetch()}
        />
      ) : (
        <>
          <Card style={styles.head}>
            <Text variant="micro" tone="muted">
              {invoice.data.number}
            </Text>
            <Text variant="title" weight="bold">
              {formatInr(invoice.data.netPaise)}
            </Text>
            <Text variant="caption" tone="secondary">
              {invoice.data.categoryName} · {invoice.data.providerName}
            </Text>
            <Text variant="micro" tone="muted">
              {new Date(invoice.data.issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
            {invoice.data.serviceAddress ? (
              <Text variant="micro" tone="muted">
                {invoice.data.serviceAddress}
              </Text>
            ) : null}
          </Card>

          <Spacer h={spacing.md} />
          <Card style={styles.lines}>
            <Line label="Labour" paise={invoice.data.lines.labourPaise} />
            {invoice.data.lines.visitFeePaise > 0 ? <Line label="Visit fee" paise={invoice.data.lines.visitFeePaise} /> : null}
            {invoice.data.lines.materialPaise > 0 ? <Line label="Materials" paise={invoice.data.lines.materialPaise} /> : null}
            {invoice.data.lines.deliveryPaise > 0 ? <Line label="Delivery" paise={invoice.data.lines.deliveryPaise} /> : null}

            <View style={styles.rule} />
            <Line label="Platform fee" paise={invoice.data.lines.platformFeePaise} muted />
            {invoice.data.lines.protectionFeePaise > 0 ? (
              <Line label="Protection fee" paise={invoice.data.lines.protectionFeePaise} muted />
            ) : null}
            <Line label="GST on fees" paise={invoice.data.lines.taxPaise} muted />
            {invoice.data.lines.discountPaise > 0 ? (
              <Line label="Discount" paise={-invoice.data.lines.discountPaise} positive />
            ) : null}

            <View style={styles.rule} />
            <Line label="Charged" paise={invoice.data.totalPaise} bold />
            {invoice.data.refundedPaise > 0 ? (
              <>
                <Line label="Refunded" paise={-invoice.data.refundedPaise} positive />
                {/* "Total" on a receipt has to mean the number that left their account. */}
                <Line label="You paid" paise={invoice.data.netPaise} bold />
              </>
            ) : null}
          </Card>

          <Spacer h={spacing.md} />
          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={14} color={palette.textMuted} />
            <Text variant="micro" tone="muted" style={{ flex: 1 }}>
              GST applies to our fee for arranging the work, not to the work itself. Your professional
              is paid the amount you agreed.
            </Text>
          </View>

          <Spacer h={spacing.lg} />
          <Button title="Share receipt" variant="secondary" icon="share-outline" fullWidth onPress={() => void share()} />
        </>
      )}
    </Screen>
  );
}

function Line({ label, paise, muted, bold, positive }: { label: string; paise: number; muted?: boolean; bold?: boolean; positive?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant={bold ? 'label' : 'caption'} weight={bold ? 'bold' : 'medium'} tone={muted ? 'muted' : 'secondary'} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text
        variant={bold ? 'label' : 'caption'}
        weight={bold ? 'bold' : 'semibold'}
        style={positive ? { color: palette.primary } : undefined}
      >
        {paise < 0 ? `- ${formatInr(Math.abs(paise))}` : formatInr(paise)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  head: { gap: 2 },
  lines: { gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rule: { height: 1, backgroundColor: '#EEF4F2', marginVertical: 2 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  card: { borderRadius: radius.md },
});
