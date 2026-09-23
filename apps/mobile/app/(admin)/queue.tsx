import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { TWO_PERSON_REFUND_THRESHOLD_PAISE, formatInr, type DisputeView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useDisputeQueue, useMfaStatus, useMoveDispute, useResolveDispute } from '@/api/admin';
import { MfaGate } from '@/features/admin/MfaGate';
import { palette, radius, spacing, typography } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

const RESOLUTIONS = [
  { key: 'NO_ACTION', label: 'No action' },
  { key: 'REWORK', label: 'Rework' },
  { key: 'PARTIAL_REFUND', label: 'Partial refund' },
  { key: 'FULL_REFUND', label: 'Full refund' },
] as const;

export default function DisputeQueueScreen() {
  const mfa = useMfaStatus();
  const unlocked = !!mfa.data && (mfa.data.verifiedForSession || !mfa.data.requiredForAdmin);
  const queue = useDisputeQueue(unlocked);

  return (
    <Screen withTabBar refreshing={queue.isRefetching} onRefresh={() => void queue.refetch()}>
      <Text variant="title" weight="bold">
        Disputes
      </Text>
      <Text variant="caption" tone="secondary">
        Soonest promised answer first. Money on these jobs is frozen until you decide.
      </Text>
      <Spacer h={spacing.lg} />

      <MfaGate>
        {queue.isPending ? (
          <Card style={styles.card}>
            <Skeleton height={18} width="55%" />
            <Skeleton height={64} />
          </Card>
        ) : queue.isError ? (
          <ErrorState title="Could not load the queue" body="Check your connection and try again." onRetry={() => void queue.refetch()} />
        ) : queue.data.items.length === 0 ? (
          <EmptyState icon="checkmark-done-outline" title="Nothing waiting" body="Every dispute has been dealt with." />
        ) : (
          <View style={styles.list}>
            {queue.data.items.map((d, i) => (
              <Animated.View key={d.id} entering={FadeInDown.delay(i * 50).duration(320)}>
                <DisputeCard dispute={d} />
              </Animated.View>
            ))}
          </View>
        )}
      </MfaGate>
    </Screen>
  );
}

function DisputeCard({ dispute }: { dispute: DisputeView }) {
  const resolve = useResolveDispute();
  const move = useMoveDispute();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<string>('NO_ACTION');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [approver, setApprover] = useState('');
  const [error, setError] = useState<string | null>(null);

  const overdue = new Date(dispute.slaDueAt) < new Date();
  const refundPaise = Math.round(Number(amount || 0) * 100);
  const needsTwo = resolution === 'PARTIAL_REFUND' && refundPaise > TWO_PERSON_REFUND_THRESHOLD_PAISE;

  async function submit() {
    setError(null);
    try {
      await resolve.mutateAsync({
        id: dispute.id,
        resolution,
        reason,
        refundPaise: resolution === 'PARTIAL_REFUND' ? refundPaise : undefined,
        secondApproverId: approver.trim() || undefined,
      });
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? resolveError(e) : 'Could not save the decision.');
    }
  }

  return (
    <Card style={[styles.card, overdue && styles.cardOverdue]}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text variant="label" weight="semibold">
            {dispute.category.toLowerCase().replace(/_/g, ' ')}
          </Text>
          <Text variant="micro" tone={overdue ? 'danger' : 'muted'}>
            {overdue ? 'Past the promised time' : `Answer by ${new Date(dispute.slaDueAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`}
          </Text>
        </View>
        <Badge tone={overdue ? 'danger' : 'warning'} label={dispute.status.toLowerCase().replace('_', ' ')} />
      </View>

      <Text variant="caption" tone="secondary">
        “{dispute.description}”
      </Text>

      {dispute.needsHuman && (
        <View style={styles.note}>
          <Ionicons name="person-outline" size={14} color={palette.danger} />
          <Text variant="micro" style={{ color: palette.danger, flex: 1 }}>
            This category is decided by a person. No automated rule may close it.
          </Text>
        </View>
      )}

      {dispute.evidenceUrls.length > 0 && (
        <Text variant="micro" tone="muted">
          {dispute.evidenceUrls.length} piece{dispute.evidenceUrls.length > 1 ? 's' : ''} of evidence attached
        </Text>
      )}

      {!open ? (
        <View style={styles.actions}>
          <Button title="Escalate" size="sm" variant="ghost" style={styles.action} loading={move.isPending} onPress={() => move.mutate({ id: dispute.id, to: 'ESCALATED' })} />
          <Button title="Decide" size="sm" style={styles.action} onPress={() => setOpen(true)} />
        </View>
      ) : (
        <View style={styles.form}>
          <View style={styles.chips}>
            {RESOLUTIONS.map((r) => (
              <Pressable key={r.key} accessibilityRole="button" onPress={() => setResolution(r.key)} style={[styles.chip, resolution === r.key && styles.chipOn]}>
                <Text variant="micro" weight="semibold" style={{ color: resolution === r.key ? '#FFFFFF' : palette.textSecondary }}>
                  {r.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {resolution === 'PARTIAL_REFUND' && (
            <TextInput
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 7))}
              keyboardType="number-pad"
              placeholder="Refund in rupees"
              placeholderTextColor="#A9B8B1"
              style={styles.input}
              accessibilityLabel="Refund amount in rupees"
            />
          )}

          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Why this decision? Both sides will see it."
            placeholderTextColor="#A9B8B1"
            multiline
            style={[styles.input, styles.multiline]}
            accessibilityLabel="Reason"
          />

          {needsTwo && (
            <>
              <View style={styles.note}>
                <Ionicons name="people-outline" size={14} color="#B26A00" />
                <Text variant="micro" style={{ color: '#7A5200', flex: 1 }}>
                  Over {formatInr(TWO_PERSON_REFUND_THRESHOLD_PAISE)} needs a second approver, and it cannot be you.
                </Text>
              </View>
              <TextInput
                value={approver}
                onChangeText={setApprover}
                placeholder="Second approver's user id"
                placeholderTextColor="#A9B8B1"
                autoCapitalize="none"
                style={styles.input}
                accessibilityLabel="Second approver user id"
              />
            </>
          )}

          {error && (
            <Text variant="caption" style={{ color: palette.danger }}>
              {error}
            </Text>
          )}

          <View style={styles.actions}>
            <Button title="Cancel" size="sm" variant="ghost" style={styles.action} onPress={() => setOpen(false)} />
            <Button title="Save decision" size="sm" style={styles.action} loading={resolve.isPending} onPress={submit} />
          </View>
        </View>
      )}
    </Card>
  );
}

function resolveError(e: ApiError): string {
  const first = (e.details as { finance?: string[] } | undefined)?.finance?.[0];
  switch (first) {
    case 'SECOND_APPROVER_REQUIRED':
      return 'A refund this size needs a second approver.';
    case 'SECOND_APPROVER_MUST_DIFFER':
      return 'The second approver has to be someone else.';
    case 'REFUND_EXCEEDS_CAPTURE':
      return 'That is more than was ever charged on this job.';
    case 'DISPUTE_CLOSED':
      return 'This dispute is already closed.';
    default:
      return e.message;
  }
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: { gap: spacing.md },
  cardOverdue: { borderWidth: 2, borderColor: palette.danger },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  form: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#F1F6F4' },
  chipOn: { backgroundColor: palette.primary },
  input: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#E4EDE9',
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    fontSize: 15,
    fontFamily: typography.family.regular,
    color: palette.text,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
});
