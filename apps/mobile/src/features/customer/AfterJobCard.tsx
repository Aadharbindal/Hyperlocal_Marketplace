import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { formatInr, type DisputeView, type JobStatus } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useDisputes, useJobMoney, useLeaveReview, useRaiseDispute } from '@/api/finance';
import { palette, radius, spacing, typography } from '@/theme';
import { Badge, Button, Card, Text } from '@/ui';

const AFTER: JobStatus[] = ['COMPLETED', 'SETTLED', 'DISPUTED', 'REFUNDED'];

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'POOR_WORKMANSHIP', label: 'The work is not right' },
  { key: 'INCOMPLETE_WORK', label: 'It was left unfinished' },
  { key: 'PROPERTY_DAMAGE', label: 'Something was damaged' },
  { key: 'INCORRECT_PRICING', label: 'The price is wrong' },
  { key: 'LATE_ARRIVAL', label: 'They were very late' },
  { key: 'PAYMENT_ISSUE', label: 'Something about the payment' },
];

/**
 * What the customer sees once the job is over: what was actually charged, the review, and the
 * way to raise a problem. Money shown here comes from the server's record, never a local sum.
 */
export function AfterJobCard({ jobId, status }: { jobId: string; status: JobStatus }) {
  const enabled = AFTER.includes(status);
  const money = useJobMoney(jobId, enabled);
  const disputes = useDisputes(jobId, enabled);
  const [reviewing, setReviewing] = useState(false);
  const [disputing, setDisputing] = useState(false);
  if (!enabled || !money.data) return null;

  const open = disputes.data?.items.find((dpt) => !dpt.resolvedAt) ?? null;
  const resolved = disputes.data?.items.find((dpt) => !!dpt.resolvedAt) ?? null;

  return (
    <View style={styles.wrap}>
      <Card style={styles.card}>
        <View style={styles.head}>
          <Ionicons name="receipt-outline" size={17} color={palette.primaryDeep} />
          <Text weight="bold" style={styles.title}>
            What you paid
          </Text>
        </View>

        <View style={styles.breakdown}>
          <Row label="Charged for the work" value={formatInr(money.data.capturedPaise)} />
          {money.data.materialPaise > 0 && <Row label="Materials" value={formatInr(money.data.materialPaise)} />}
          {money.data.refundedPaise > 0 && <Row label="Refunded to you" value={`- ${formatInr(money.data.refundedPaise)}`} refund />}
          <View style={styles.divider} />
          <Row
            label="Net"
            value={formatInr(money.data.capturedPaise + money.data.materialPaise - money.data.refundedPaise)}
            bold
          />
        </View>

        {money.data.refunds.map((r) => (
          <View key={r.id} style={styles.note}>
            <Ionicons name="arrow-undo-outline" size={14} color={palette.primaryDeep} />
            <Text variant="micro" tone="muted" style={{ flex: 1 }}>
              {formatInr(r.amountPaise)} refunded — {r.reason}
            </Text>
          </View>
        ))}
      </Card>

      {open ? (
        <DisputeCard dispute={open} />
      ) : (
        <View style={styles.actions}>
          {!resolved && (
            <Button title="Report a problem" size="sm" variant="ghost" style={styles.action} icon="alert-circle-outline" onPress={() => setDisputing(true)} />
          )}
          <Button title="Rate the work" size="sm" style={styles.action} icon="star-outline" onPress={() => setReviewing(true)} />
        </View>
      )}

      {resolved && <DisputeCard dispute={resolved} />}

      <ReviewSheet jobId={jobId} visible={reviewing} onClose={() => setReviewing(false)} />
      <DisputeSheet jobId={jobId} visible={disputing} onClose={() => setDisputing(false)} />
    </View>
  );
}

function DisputeCard({ dispute }: { dispute: DisputeView }) {
  return (
    <Card style={[styles.card, !dispute.resolvedAt && styles.cardAlert]}>
      <View style={styles.head}>
        <Ionicons name={dispute.resolvedAt ? 'checkmark-circle' : 'time-outline'} size={17} color={dispute.resolvedAt ? palette.primary : '#B26A00'} />
        <Text weight="semibold" style={{ flex: 1 }}>
          {dispute.resolvedAt ? 'Your report was resolved' : 'We are looking into it'}
        </Text>
        <Badge tone={dispute.resolvedAt ? 'success' : 'warning'} label={dispute.status.toLowerCase().replace('_', ' ')} />
      </View>
      <Text variant="caption" tone="secondary">
        “{dispute.description}”
      </Text>
      {dispute.resolutionReason && (
        <Text variant="caption" tone="secondary">
          {dispute.resolutionReason}
        </Text>
      )}
      {dispute.refundPaise ? <Badge tone="success" icon="arrow-undo-outline" label={`${formatInr(dispute.refundPaise)} refunded`} /> : null}
      {!dispute.resolvedAt && (
        <Text variant="micro" tone="muted">
          Support will reply by {new Date(dispute.slaDueAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.
          {dispute.needsHuman ? ' A person reviews this kind of report — never an automated rule.' : ''}
        </Text>
      )}
    </Card>
  );
}

function ReviewSheet({ jobId, visible, onClose }: { jobId: string; visible: boolean; onClose: () => void }) {
  const review = useLeaveReview();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await review.mutateAsync({ jobId, rating, comment: comment.trim() || undefined });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your rating.');
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="How did it go?">
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} star`} hitSlop={6} onPress={() => setRating(n)}>
            <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={34} color={n <= rating ? '#F0A400' : '#C2CEC9'} />
          </Pressable>
        ))}
      </View>
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="Anything worth telling the next customer?"
        placeholderTextColor="#A9B8B1"
        multiline
        style={[styles.input, styles.multiline]}
        accessibilityLabel="Comment"
      />
      {error && (
        <Text variant="caption" style={{ color: palette.danger }}>
          {error}
        </Text>
      )}
      <Button title="Post rating" fullWidth loading={review.isPending} onPress={submit} />
    </Sheet>
  );
}

function DisputeSheet({ jobId, visible, onClose }: { jobId: string; visible: boolean; onClose: () => void }) {
  const raise = useRaiseDispute();
  const [category, setCategory] = useState(CATEGORIES[0]!.key);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await raise.mutateAsync({ jobId, category, description });
      setDescription('');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? disputeError(e) : 'Could not send your report.');
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Report a problem">
      <Text variant="caption" tone="secondary">
        Your payment is held while we look into it. The provider is not paid until it is settled.
      </Text>
      <View style={styles.chips}>
        {CATEGORIES.map((c) => (
          <Pressable
            key={c.key}
            accessibilityRole="button"
            onPress={() => setCategory(c.key)}
            style={[styles.chip, category === c.key && styles.chipOn]}
          >
            <Text variant="micro" weight="semibold" style={{ color: category === c.key ? '#FFFFFF' : palette.textSecondary }}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="What happened? The more detail, the faster support can decide."
        placeholderTextColor="#A9B8B1"
        multiline
        style={[styles.input, styles.multiline]}
        accessibilityLabel="What happened"
      />
      {error && (
        <Text variant="caption" style={{ color: palette.danger }}>
          {error}
        </Text>
      )}
      <Button title="Send report" fullWidth loading={raise.isPending} onPress={submit} />
    </Sheet>
  );
}

function disputeError(e: ApiError): string {
  const first = (e.details as { finance?: string[] } | undefined)?.finance?.[0];
  switch (first) {
    case 'REASON_TOO_SHORT':
      return 'Please describe what went wrong in a bit more detail.';
    case 'ALREADY_OPEN':
      return 'You already have a report open on this job.';
    case 'WINDOW_CLOSED':
      return 'This job is too old to report. Contact support instead.';
    default:
      return e.message;
  }
}

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <Animated.View entering={FadeInDown.duration(260)} style={styles.sheet}>
        <View style={styles.grabber} />
        <Text weight="bold" style={styles.sheetTitle}>
          {title}
        </Text>
        {children}
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
          <Text variant="caption" weight="semibold" tone="muted">
            Not now
          </Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

function Row({ label, value, bold, refund }: { label: string; value: string; bold?: boolean; refund?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant="caption" tone={bold ? 'default' : 'muted'}>
        {label}
      </Text>
      <Text variant="caption" weight={bold ? 'bold' : 'medium'} style={refund ? { color: palette.primaryDeep } : undefined}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, gap: spacing.md },
  card: { gap: spacing.md },
  cardAlert: { borderWidth: 2, borderColor: '#FFD38A' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 16 },
  breakdown: { backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 2 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },

  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: palette.overlay },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.lg,
    gap: spacing.md,
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: palette.border },
  sheetTitle: { fontSize: 18, color: palette.text },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: '#F1F6F4' },
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
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  cancel: { alignItems: 'center', minHeight: 40, justifyContent: 'center' },
});
