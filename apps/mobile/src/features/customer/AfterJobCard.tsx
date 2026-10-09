import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { checkMeaningfulText, checkReviewComment, formatInr, type DisputeView, type JobStatus } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { askForPhoto } from '@/features/capture/media';
import { useAddEvidence } from '@/api/execution';
import {
  useAddDisputeEvidence,
  useAppealDispute,
  useDisputes,
  useJobMoney,
  useLeaveReview,
  useRaiseDispute,
} from '@/api/finance';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, DataRow, SegmentedControl, Text, TextField } from '@/ui';

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
          <DataRow label="Charged for the work" value={formatInr(money.data.capturedPaise)} />
          {money.data.materialPaise > 0 && <DataRow label="Materials" value={formatInr(money.data.materialPaise)} />}
          {money.data.refundedPaise > 0 && (
            <DataRow label="Refunded to you" value={`- ${formatInr(money.data.refundedPaise)}`} tone="primary" />
          )}
          <DataRow
            label="Net"
            value={formatInr(money.data.capturedPaise + money.data.materialPaise - money.data.refundedPaise)}
            total
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

/**
 * A report, and the two things somebody can still do about it.
 *
 * Both endpoints behind this have existed since the finance work with nothing calling them. The
 * effect was that a decision was final the moment it was made - DISPUTE_POLICY section 6 grants an
 * appeal and the app offered no way to use it - and that a customer who found the receipt an hour
 * after reporting the problem had nowhere to put it, so support decided on whatever was in the
 * first message.
 */
function DisputeCard({ dispute }: { dispute: DisputeView }) {
  const appeal = useAppealDispute();
  const addEvidence = useAddDisputeEvidence();
  const uploadEvidence = useAddEvidence();
  const [appealing, setAppealing] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Twenty characters is the server's floor for an appeal, and the junk check is the shared one -
  // "not fair" is not a ground for review and would be refused after the typing rather than before.
  const reasonProblem = reason.trim() ? checkMeaningfulText(reason, 20, 'Your reason') : null;
  const canSendAppeal = reason.trim().length >= 20 && !reasonProblem;

  function attach() {
    setError(null);
    askForPhoto(
      (file) => {
        void (async () => {
          setBusy(true);
          try {
            const shot = await uploadEvidence.mutateAsync({ jobId: dispute.jobId, file });
            await addEvidence.mutateAsync({
              jobId: dispute.jobId,
              disputeId: dispute.id,
              mediaIds: [shot.media.id],
              ...(note.trim() ? { note: note.trim() } : {}),
            });
            setNote('');
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'That did not attach. Please try again.');
          } finally {
            setBusy(false);
          }
        })();
      },
      (m) => setError(m),
    );
  }

  async function sendAppeal() {
    setError(null);
    try {
      await appeal.mutateAsync({ jobId: dispute.jobId, disputeId: dispute.id, reason: reason.trim() });
      setAppealing(false);
      setReason('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not send. Please try again.');
    }
  }

  return (
    <Card style={[styles.card, !dispute.resolvedAt && styles.cardAlert]}>
      <View style={styles.head}>
        <Ionicons name={dispute.resolvedAt ? 'checkmark-circle' : 'time-outline'} size={17} color={dispute.resolvedAt ? palette.primary : palette.warningIcon} />
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
        <>
          <Text variant="micro" tone="muted">
            Support will reply by {new Date(dispute.slaDueAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.
            {dispute.needsHuman ? ' A person reviews this kind of report — never an automated rule.' : ''}
          </Text>
          {dispute.evidenceUrls.length > 0 ? (
            <Text variant="micro" tone="muted">
              {dispute.evidenceUrls.length === 1 ? '1 photo attached' : `${dispute.evidenceUrls.length} photos attached`}
            </Text>
          ) : null}
          {/* While it is still open, anything that arrives late can still change the answer. */}
          <TextField
            label="Anything else to add? (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="The receipt shows the second charge"
            multiline
            minLines={2}
            maxLength={500}
          />
          <Button
            title="Add a photo"
            size="sm"
            variant="secondary"
            icon="camera-outline"
            loading={busy}
            onPress={attach}
          />
        </>
      )}

      {dispute.resolvedAt && dispute.canAppeal ? (
        appealing ? (
          <View style={styles.appeal}>
            <TextField
              label="Why should this be looked at again?"
              helper="Somebody who did not make the first decision reads this"
              value={reason}
              onChangeText={setReason}
              placeholder="The photos were taken before the work was finished, not after."
              multiline
              minLines={3}
              maxLength={1000}
              counter
              required
              error={reasonProblem?.message ?? null}
            />
            <View style={styles.appealActions}>
              <Button title="Never mind" size="sm" variant="ghost" onPress={() => setAppealing(false)} />
              <Button title="Send appeal" size="sm" loading={appeal.isPending} disabled={!canSendAppeal} onPress={() => void sendAppeal()} />
            </View>
          </View>
        ) : (
          <>
            <Button title="Ask for another look" size="sm" variant="secondary" icon="refresh-outline" onPress={() => setAppealing(true)} />
            {dispute.appealClosesAt ? (
              /* The deadline said out loud. One appeal, seven days - somebody deciding whether to
                 bother should not have to find that out by missing it. */
              <Text variant="micro" tone="muted">
                You can ask once, until {new Date(dispute.appealClosesAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.
              </Text>
            ) : null}
          </>
        )
      ) : dispute.alreadyAppealed ? (
        <Text variant="micro" tone="muted">
          You have asked for another look at this one. Somebody who did not make the first decision
          is reviewing it.
        </Text>
      ) : null}

      {error ? (
        <Text variant="micro" tone="danger">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

function ReviewSheet({ jobId, visible, onClose }: { jobId: string; visible: boolean; onClose: () => void }) {
  const review = useLeaveReview();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const commentProblem = comment.trim() ? checkReviewComment(comment) : null;
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
            <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={34} color={n <= rating ? palette.ratingOn : palette.iconFaint} />
          </Pressable>
        ))}
      </View>
      <TextField
        label="Anything worth telling the next customer? (optional)"
        value={comment}
        onChangeText={setComment}
        placeholder="Arrived on time and cleaned up afterwards"
        multiline
        minLines={2}
        maxLength={400}
        counter
        error={commentProblem?.message ?? null}
      />
      {error && (
        <Text variant="caption" style={{ color: palette.danger }}>
          {error}
        </Text>
      )}
      <Button title="Post rating" fullWidth loading={review.isPending} disabled={!!commentProblem} onPress={submit} />
    </Sheet>
  );
}

function DisputeSheet({ jobId, visible, onClose }: { jobId: string; visible: boolean; onClose: () => void }) {
  const raise = useRaiseDispute();
  const [category, setCategory] = useState(CATEGORIES[0]!.key);
  const [description, setDescription] = useState('');
  const descriptionProblem = description.trim() ? checkMeaningfulText(description, 20, 'Your report') : null;
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
      <SegmentedControl
        label="What kind of problem"
        options={CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
        value={category}
        onChange={setCategory}
      />
      <TextField
        label="What happened"
        helper="The more detail, the faster support can decide"
        value={description}
        onChangeText={setDescription}
        placeholder="The tap still drips and the professional left before testing it"
        multiline
        minLines={3}
        maxLength={600}
        counter
        required
        error={descriptionProblem?.message ?? null}
      />
      {error && (
        <Text variant="caption" style={{ color: palette.danger }}>
          {error}
        </Text>
      )}
      <Button
        title="Send report"
        fullWidth
        loading={raise.isPending}
        disabled={!description.trim() || !!descriptionProblem}
        onPress={submit}
      />
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

const styles = StyleSheet.create({
  appeal: { gap: spacing.md },
  appealActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  wrap: { marginTop: spacing.lg, gap: spacing.md },
  card: { gap: spacing.md },
  cardAlert: { borderWidth: 2, borderColor: '#FFD38A' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 16 },
  breakdown: { backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: spacing.md, gap: 6 },
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
  cancel: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
});
