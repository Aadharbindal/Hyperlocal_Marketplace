import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { formatInr } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useAdminRefund, useJobLedger } from '@/api/admin';
import { palette, radius, spacing, typography } from '@/theme';
import { Button, Card, Skeleton, Text } from '@/ui';

/**
 * "Where did my money go?" - answered without running SQL against production.
 *
 * Support is asked this constantly, and until now the only way to answer was a database session,
 * which is both slow and a habit worth not having. The ledger is append-only and double-entry,
 * so the net at the bottom is the point of the screen: it is what the platform still holds for
 * that booking, and if it looks wrong then something is wrong.
 *
 * The refund sits underneath rather than beside each line, because this is a decision somebody
 * makes rather than a correction to a row - and it asks for a real reason, which is what another
 * person reads a year later when asked to justify it.
 */
export function JobLedgerPanel({ unlocked }: { unlocked: boolean }) {
  const [jobId, setJobId] = useState('');
  const [lookingAt, setLookingAt] = useState('');
  const ledger = useJobLedger(lookingAt, unlocked);

  const refund = useAdminRefund();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const paise = Math.round(Number(amount || 0) * 100);
  const canRefund = paise > 0 && reason.trim().length >= 10;

  function askThenRefund() {
    Alert.alert(
      `Refund ${formatInr(paise)}?`,
      'This moves money back to the customer and is written to the ledger under your name. It cannot be undone from here.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Refund',
          style: 'destructive',
          onPress: () => {
            setError(null);
            void refund
              .mutateAsync({ jobId: lookingAt, amountPaise: paise, reason: reason.trim() })
              .then(() => {
                setAmount('');
                setReason('');
              })
              .catch((e) => setError(e instanceof ApiError ? e.message : 'The refund did not go through.'));
          },
        },
      ],
    );
  }

  return (
    <View style={styles.wrap}>
      <Text variant="heading" weight="bold">
        One booking&apos;s money
      </Text>
      <View style={styles.lookup}>
        <TextInput
          value={jobId}
          onChangeText={setJobId}
          placeholder="Booking id"
          placeholderTextColor="#A9B8B1"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { flex: 1 }]}
          accessibilityLabel="Booking id"
        />
        <Button title="Look up" size="sm" disabled={jobId.trim().length < 8} onPress={() => setLookingAt(jobId.trim())} />
      </View>

      {!lookingAt ? null : ledger.isPending ? (
        <Skeleton height={120} />
      ) : ledger.isError ? (
        <Text variant="caption" tone="danger">
          No ledger for that id.
        </Text>
      ) : (
        <Animated.View entering={FadeInDown.duration(280)}>
          <Card style={styles.card} padding="md">
            {ledger.data.items.map((e) => (
              <View key={e.id} style={styles.line}>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text variant="micro" weight="semibold">
                    {e.entryType.replace(/_/g, ' ').toLowerCase()}
                  </Text>
                  {e.note ? (
                    <Text variant="micro" tone="muted" numberOfLines={1}>
                      {e.note}
                    </Text>
                  ) : null}
                </View>
                {/* Signed, because a double-entry line that does not show its direction is
                    unreadable - a credit and a debit look identical without it. */}
                <Text
                  variant="micro"
                  weight="bold"
                  style={{ color: e.amountPaise < 0 ? palette.danger : palette.primaryDeep }}
                >
                  {`${e.amountPaise < 0 ? '-' : '+'}${formatInr(Math.abs(e.amountPaise))}`}
                </Text>
              </View>
            ))}

            <View style={styles.net}>
              <Text variant="label" weight="bold" style={{ flex: 1 }}>
                Net held
              </Text>
              <Text variant="label" weight="bold">
                {formatInr(ledger.data.netPaise)}
              </Text>
            </View>
          </Card>

          <View style={styles.refund}>
            <Text variant="caption" weight="semibold">
              Refund on this booking
            </Text>
            <TextInput
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, '').slice(0, 9))}
              keyboardType="decimal-pad"
              placeholder="Amount in rupees"
              placeholderTextColor="#A9B8B1"
              style={styles.input}
              accessibilityLabel="Refund amount in rupees"
            />
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Why — somebody reads this when asked to justify it"
              placeholderTextColor="#A9B8B1"
              multiline
              style={[styles.input, styles.multiline]}
              accessibilityLabel="Reason for the refund"
            />
            {error ? (
              <Animated.View entering={FadeIn.duration(160)}>
                <Text variant="micro" tone="danger">
                  {error}
                </Text>
              </Animated.View>
            ) : null}
            <Button
              title="Issue refund"
              size="sm"
              variant="danger"
              fullWidth
              icon="return-down-back"
              disabled={!canRefund}
              loading={refund.isPending}
              onPress={askThenRefund}
            />
            <View style={styles.note}>
              <Ionicons name="information-circle-outline" size={13} color={palette.textMuted} />
              <Text variant="micro" tone="muted" style={{ flex: 1 }}>
                Only money that was actually captured can be sent back. Anything still only
                authorised is released by cancelling, not refunded.
              </Text>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  lookup: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  card: { gap: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  net: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderTopWidth: 1, borderTopColor: '#EEF4F2', paddingTop: spacing.sm, marginTop: spacing.xs },
  refund: { gap: spacing.sm, marginTop: spacing.lg },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#E4EDE9',
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    fontSize: 15,
    fontFamily: typography.family.regular,
    color: palette.text,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
});
