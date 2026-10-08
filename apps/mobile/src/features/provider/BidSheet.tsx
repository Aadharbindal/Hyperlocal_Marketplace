import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import {
  DEFAULT_FEE_POLICY,
  checkMeaningfulText,
  checkRupees,
  computeQuote,
  formatInr,
  type NearbyJobItem,
} from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { usePlaceBid, useReviseBid, type BidTerms } from '@/api/provider';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, DataRow, SegmentedControl, Text, TextField } from '@/ui';

const ETA_OPTIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: 'Today', minutes: 480 },
  { label: 'Tomorrow', minutes: 1440 },
];
const WARRANTY_OPTIONS = [0, 7, 15, 30];

interface Props {
  job: NearbyJobItem | null;
  onClose: () => void;
}

/** Quick-bid sheet: labour, visit fee, ETA and warranty, with the customer total shown live. */
export function BidSheet({ job, onClose }: Props) {
  const [labour, setLabour] = useState('');
  const [visitFee, setVisitFee] = useState('');
  const [etaMinutes, setEtaMinutes] = useState(60);
  const [warrantyDays, setWarrantyDays] = useState(7);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const place = usePlaceBid();
  const revise = useReviseBid();
  const revising = !!job?.myBid;

  const labourPaise = Math.round((Number(labour) || 0) * 100);
  const visitFeePaise = Math.round((Number(visitFee) || 0) * 100);
  const quote = computeQuote({ labourPaise, visitFeePaise }, DEFAULT_FEE_POLICY);

  /**
   * The two amounts, checked beyond "greater than zero".
   *
   * The error that actually happens on this sheet is the extra zero - 6000 typed where 600 was
   * meant - and a bare positive check sends that to the customer as a real offer. The ceilings are
   * deliberately generous rather than tight: a full rewire genuinely is tens of thousands of rupees,
   * so these are set where a number stops being a price and starts being a slip.
   */
  const labourProblem = checkRupees(labour, { min: 0, max: 500_000, what: 'A labour charge' });
  const visitFeeProblem = checkRupees(visitFee, { min: 0, max: 20_000, what: 'A visit fee' });
  const notesProblem = notes.trim() ? checkMeaningfulText(notes, 5, 'The note') : null;
  const valid = (labourPaise > 0 || visitFeePaise > 0) && !labourProblem && !visitFeeProblem && !notesProblem;

  function reset() {
    setLabour('');
    setVisitFee('');
    setEtaMinutes(60);
    setWarrantyDays(7);
    setNotes('');
    setError(null);
  }

  async function submit() {
    if (!job || !valid) return;
    setError(null);
    const terms: BidTerms = {
      labourPaise,
      visitFeePaise,
      etaMinutes,
      warrantyDays,
      materialResponsibility: job.requestType === 'LABOUR_AND_MATERIAL' ? 'PROVIDER' : 'CUSTOMER',
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    try {
      if (revising && job.myBid) await revise.mutateAsync({ bidId: job.myBid.id, ...terms });
      else await place.mutateAsync({ jobId: job.jobId, ...terms });
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? bidError(e) : 'Something went wrong. Please try again.');
    }
  }

  const busy = place.isPending || revise.isPending;

  return (
    <Modal visible={!!job} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <Animated.View entering={FadeInDown.duration(280)} style={styles.sheet}>
        <View style={styles.grabber} />
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.head}>
            <View style={styles.headText}>
              <Text weight="bold" style={styles.title}>
                {revising ? 'Update your offer' : 'Send your offer'}
              </Text>
              <Text variant="caption" tone="secondary">
                {job?.categoryName} · {job?.areaLabel} · {job?.distanceKm} km
              </Text>
            </View>
            {job?.priority === 'URGENT' && <Badge tone="warning" icon="flash" label="Urgent" />}
          </View>

          {revising && job?.myBid ? (
            <View style={styles.reviseNote}>
              <Ionicons name="information-circle" size={16} color={palette.primaryDeep} />
              <Text variant="caption" style={{ color: palette.primaryDeep, flex: 1 }}>
                Revision {job.myBid.revisionNo + 1} of 2. Your current offer is {formatInr(job.myBid.labourPaise + job.myBid.visitFeePaise)}.
              </Text>
            </View>
          ) : null}

          <TextField
            label="Labour charge"
            prefix="₹"
            value={labour}
            onChangeText={setLabour}
            placeholder="600"
            keyboardType="number-pad"
            maxLength={7}
            autoFocus
            error={labourProblem?.message ?? null}
          />

          <TextField
            label="Visit / inspection fee"
            helper="Leave empty if you do not charge for the visit"
            prefix="₹"
            value={visitFee}
            onChangeText={setVisitFee}
            placeholder="0"
            keyboardType="number-pad"
            maxLength={6}
            error={visitFeeProblem?.message ?? null}
          />

          <Text weight="semibold" style={styles.label}>
            You can reach in
          </Text>
          <SegmentedControl
            label="You can reach in"
            options={ETA_OPTIONS.map((o) => ({ value: String(o.minutes), label: o.label }))}
            value={String(etaMinutes)}
            onChange={(v) => setEtaMinutes(Number(v))}
          />

          <Text weight="semibold" style={styles.label}>
            Warranty
          </Text>
          <SegmentedControl
            label="Warranty"
            options={WARRANTY_OPTIONS.map((d) => ({ value: String(d), label: d === 0 ? 'None' : `${d} days` }))}
            value={String(warrantyDays)}
            onChange={(v) => setWarrantyDays(Number(v))}
          />

          <TextField
            label="Note to the customer (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="I will bring a replacement cartridge"
            icon="chatbubble-ellipses-outline"
            multiline
            minLines={2}
            maxLength={500}
            counter
            error={notesProblem?.message ?? null}
          />

          {/* Transparent breakdown - the provider sees exactly what the customer pays, and what is
              taken out of it. `total` draws the rule, so the two numbers that matter are not two
              more line items in a list of six. */}
          <View style={styles.breakdown}>
            <DataRow label="Labour" value={formatInr(labourPaise)} />
            {visitFeePaise > 0 && <DataRow label="Visit fee" value={formatInr(visitFeePaise)} />}
            <DataRow label="Platform fee" value={formatInr(quote.platformFeePaise)} tone="muted" />
            <DataRow label="Tax on fee" value={formatInr(quote.taxPaise)} tone="muted" />
            <DataRow label="Customer pays" value={formatInr(quote.totalPaise)} total />
            <DataRow label="You receive" value={formatInr(quote.providerPayablePaise)} tone="primary" total />
          </View>

          {error && (
            <Animated.View entering={FadeIn.duration(200)} style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color={palette.danger} />
              <Text variant="caption" style={{ color: palette.danger, flex: 1 }}>
                {error}
              </Text>
            </Animated.View>
          )}

          <Button
            title={revising ? 'Update offer' : 'Send offer'}
            fullWidth
            iconRight="paper-plane"
            style={styles.cta}
            disabled={!valid}
            loading={busy}
            onPress={submit}
          />
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
            <Text variant="caption" weight="semibold" tone="muted">
              Not now
            </Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function bidError(e: ApiError): string {
  const details = e.details as { bid?: string[]; eligibility?: string[]; reason?: string } | undefined;
  const first = details?.bid?.[0] ?? details?.eligibility?.[0] ?? details?.reason;
  switch (first) {
    case 'WINDOW_CLOSED':
      return 'The offer window for this job has closed.';
    case 'DUPLICATE_ACTIVE_BID':
      return 'You already have a live offer on this job.';
    case 'TOO_MANY_REVISIONS':
      return 'You have used both revisions on this offer.';
    case 'JOB_FULL':
      return 'This job already has the maximum number of offers.';
    case 'ETA_OUT_OF_RANGE':
      return 'Choose a realistic arrival time.';
    case 'NOT_VERIFIED':
      return 'Your account is still being verified.';
    case 'OUT_OF_RADIUS':
      return 'This job is outside your service radius.';
    case 'CATEGORY_MISMATCH':
      return 'This job is outside the services you offer.';
    case 'job_not_accepting_offers':
      return 'This job is no longer accepting offers.';
    default:
      return e.message;
  }
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: palette.overlay },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '92%',
    backgroundColor: palette.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: palette.border, marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  headText: { flex: 1 },
  title: { fontSize: 19, lineHeight: 26, color: palette.text },
  reviseNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: palette.primarySoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },

  label: { fontSize: 14, marginTop: spacing.lg, marginBottom: spacing.sm },

  breakdown: {
    marginTop: spacing.xl,
    backgroundColor: palette.surfaceSunken,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    padding: spacing.lg,
    gap: spacing.sm,
  },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  cta: { marginTop: spacing.xl },
  cancel: { alignItems: 'center', marginTop: spacing.md, minHeight: 40, justifyContent: 'center' },
});
