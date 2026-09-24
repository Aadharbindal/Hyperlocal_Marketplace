import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { DEFAULT_FEE_POLICY, computeQuote, formatInr, type NearbyJobItem } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { usePlaceBid, useReviseBid, type BidTerms } from '@/api/provider';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Text } from '@/ui';

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
  const valid = labourPaise > 0 || visitFeePaise > 0;

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

          <Text weight="semibold" style={styles.label}>
            Labour charge
          </Text>
          <View style={styles.amountRow}>
            <Text weight="bold" style={styles.rupee}>
              ₹
            </Text>
            <TextInput
              value={labour}
              onChangeText={setLabour}
              placeholder="600"
              placeholderTextColor="#A9B8B1"
              keyboardType="number-pad"
              accessibilityLabel="Labour charge in rupees"
              style={styles.amountInput}
              autoFocus
            />
          </View>

          <Text weight="semibold" style={styles.label}>
            Visit / inspection fee <Text variant="caption" tone="muted">(optional)</Text>
          </Text>
          <View style={styles.amountRow}>
            <Text weight="bold" style={styles.rupee}>
              ₹
            </Text>
            <TextInput
              value={visitFee}
              onChangeText={setVisitFee}
              placeholder="0"
              placeholderTextColor="#A9B8B1"
              keyboardType="number-pad"
              accessibilityLabel="Visit fee in rupees"
              style={styles.amountInput}
            />
          </View>

          <Text weight="semibold" style={styles.label}>
            You can reach in
          </Text>
          <View style={styles.chips}>
            {ETA_OPTIONS.map((o) => {
              const active = o.minutes === etaMinutes;
              return (
                <Pressable key={o.minutes} onPress={() => setEtaMinutes(o.minutes)} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]}>
                  <Text variant="caption" weight="semibold" style={active ? styles.chipTextActive : undefined}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text weight="semibold" style={styles.label}>
            Warranty
          </Text>
          <View style={styles.chips}>
            {WARRANTY_OPTIONS.map((d) => {
              const active = d === warrantyDays;
              return (
                <Pressable key={d} onPress={() => setWarrantyDays(d)} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]}>
                  <Text variant="caption" weight="semibold" style={active ? styles.chipTextActive : undefined}>
                    {d === 0 ? 'None' : `${d} days`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text weight="semibold" style={styles.label}>
            Note to the customer <Text variant="caption" tone="muted">(optional)</Text>
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. I will bring a replacement cartridge"
            placeholderTextColor="#A9B8B1"
            multiline
            maxLength={500}
            accessibilityLabel="Note to the customer"
            style={styles.notes}
          />

          {/* transparent breakdown - the provider sees exactly what the customer pays */}
          <View style={styles.breakdown}>
            <Row label="Labour" value={formatInr(labourPaise)} />
            {visitFeePaise > 0 && <Row label="Visit fee" value={formatInr(visitFeePaise)} />}
            <Row label="Platform fee" value={formatInr(quote.platformFeePaise)} muted />
            <Row label="Tax on fee" value={formatInr(quote.taxPaise)} muted />
            <View style={styles.divider} />
            <Row label="Customer pays" value={formatInr(quote.totalPaise)} bold />
            <Row label="You receive" value={formatInr(quote.providerPayablePaise)} bold tone="primary" />
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

function Row({ label, value, muted, bold, tone }: { label: string; value: string; muted?: boolean; bold?: boolean; tone?: 'primary' }) {
  return (
    <View style={styles.row}>
      <Text variant="caption" tone={muted ? 'muted' : 'secondary'}>
        {label}
      </Text>
      <Text variant={bold ? 'label' : 'caption'} weight={bold ? 'bold' : 'medium'} tone={tone ?? (muted ? 'muted' : 'default')}>
        {value}
      </Text>
    </View>
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
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: palette.surfaceMuted, borderRadius: radius.md, paddingHorizontal: spacing.lg, height: 56 },
  rupee: { fontSize: 20, color: palette.textSecondary },
  amountInput: { flex: 1, fontSize: 20, fontWeight: '700', color: palette.text, height: '100%' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.lg, minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: palette.surfaceMuted },
  chipActive: { backgroundColor: palette.primary },
  chipTextActive: { color: '#FFFFFF' },

  notes: { minHeight: 70, backgroundColor: palette.surfaceMuted, borderRadius: radius.md, padding: spacing.md, fontSize: 14.5, color: palette.text, textAlignVertical: 'top' },

  breakdown: { marginTop: spacing.xl, backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: spacing.xs },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  cta: { marginTop: spacing.xl },
  cancel: { alignItems: 'center', marginTop: spacing.md, minHeight: 40, justifyContent: 'center' },
});
