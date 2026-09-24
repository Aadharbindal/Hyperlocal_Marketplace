import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { formatInr, type AcceptOfferResponse, type OfferView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useAcceptOffer, useCompleteMockPayment } from '@/api/negotiation';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Text } from '@/ui';

type Stage = 'review' | 'paying' | 'done';

/**
 * Accept -> authorize. The customer sees the exact frozen price before anything is charged,
 * and the booking is only confirmed once the gateway authorizes (PAYMENT_FLOW.md).
 */
export function ConfirmSheet({ jobId, offer, onClose }: { jobId: string; offer: OfferView | null; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>('review');
  const [accepted, setAccepted] = useState<AcceptOfferResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accept = useAcceptOffer();
  const pay = useCompleteMockPayment();

  function close() {
    setStage('review');
    setAccepted(null);
    setError(null);
    onClose();
  }

  async function onAccept() {
    if (!offer) return;
    setError(null);
    try {
      const res = await accept.mutateAsync({ jobId, bidId: offer.id });
      setAccepted(res);
      setStage('paying');
    } catch (e) {
      setError(e instanceof ApiError ? acceptError(e) : 'Something went wrong. Please try again.');
    }
  }

  async function onPay() {
    if (!accepted) return;
    setError(null);
    try {
      await pay.mutateAsync({ jobId, paymentId: accepted.payment.id, outcome: 'authorized' });
      setStage('done');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Payment could not be completed.');
    }
  }

  const q = accepted?.quote;

  return (
    <Modal visible={!!offer} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={stage === 'paying' ? undefined : close} accessibilityLabel="Close" />
      <Animated.View entering={FadeInDown.duration(280)} style={styles.sheet}>
        <View style={styles.grabber} />
        <ScrollView showsVerticalScrollIndicator={false}>
          {stage === 'done' ? (
            <Animated.View entering={FadeIn.duration(300)} style={styles.done}>
              <View style={styles.doneBadge}>
                <Ionicons name="checkmark" size={34} color="#FFFFFF" />
              </View>
              <Text weight="extrabold" style={styles.doneTitle}>
                Booking confirmed
              </Text>
              <Text variant="caption" tone="secondary" center>
                {q?.providerBusinessName ?? 'Your provider'} is confirmed. You will get a 4-digit start code to share when they arrive.
              </Text>
              <Button title="Done" fullWidth style={styles.cta} onPress={close} />
            </Animated.View>
          ) : (
            <>
              <Text weight="bold" style={styles.title}>
                {stage === 'review' ? 'Confirm this offer' : 'Authorize payment'}
              </Text>
              <Text variant="caption" tone="secondary">
                {stage === 'review'
                  ? 'This price is locked once you confirm. Extra work always needs your approval.'
                  : 'Nothing is charged until the work is approved by you.'}
              </Text>

              <View style={styles.providerRow}>
                <View style={styles.avatar}>
                  <Text weight="bold" tone="primary">
                    {(q?.providerBusinessName ?? offer?.provider.businessName ?? '?').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.providerText}>
                  <Text variant="label" weight="semibold" numberOfLines={1}>
                    {q?.providerBusinessName ?? offer?.provider.businessName}
                  </Text>
                  <Text variant="micro" tone="muted">
                    {offer ? `${offer.provider.completedJobs} jobs · ${offer.provider.distanceKm} km away` : ''}
                  </Text>
                </View>
                {offer?.provider.verified && <Badge tone="success" icon="shield-checkmark" label="Verified" />}
              </View>

              <View style={styles.breakdown}>
                <Row label="Labour" value={formatInr(q?.labourPaise ?? offer?.labourPaise ?? 0)} />
                {(q?.visitFeePaise ?? offer?.visitFeePaise ?? 0) > 0 && (
                  <Row label="Visit fee" value={formatInr(q?.visitFeePaise ?? offer?.visitFeePaise ?? 0)} />
                )}
                <Row label="Platform fee" value={formatInr(q?.platformFeePaise ?? offer?.platformFeePaise ?? 0)} muted />
                <Row label="Tax on fee" value={formatInr(q?.taxPaise ?? offer?.taxPaise ?? 0)} muted />
                <View style={styles.divider} />
                <Row label="Total" value={formatInr(q?.totalPaise ?? offer?.totalPaise ?? 0)} bold />
              </View>

              <View style={styles.tags}>
                <Badge tone="neutral" icon="time-outline" label={`${Math.round((q?.etaMinutes ?? offer?.etaMinutes ?? 0) / 60) || 1} h arrival`} />
                {(q?.warrantyDays ?? offer?.warrantyDays ?? 0) > 0 && (
                  <Badge tone="success" icon="shield-outline" label={`${q?.warrantyDays ?? offer?.warrantyDays} day warranty`} />
                )}
              </View>

              <View style={styles.assurance}>
                <Ionicons name="lock-closed" size={13} color={palette.textMuted} />
                <Text variant="micro" tone="muted" style={{ flex: 1 }}>
                  Materials, if any, are quoted separately and always need your approval.
                </Text>
              </View>

              {error && (
                <Animated.View entering={FadeIn.duration(200)} style={styles.errorRow}>
                  <Ionicons name="alert-circle" size={16} color={palette.danger} />
                  <Text variant="caption" style={{ color: palette.danger, flex: 1 }}>
                    {error}
                  </Text>
                </Animated.View>
              )}

              {stage === 'review' ? (
                <Button title="Confirm and continue" fullWidth iconRight="arrow-forward" loading={accept.isPending} style={styles.cta} onPress={onAccept} />
              ) : (
                <Button
                  title={`Authorize ${formatInr(accepted?.payment.amountPaise ?? 0)}`}
                  fullWidth
                  icon="lock-closed"
                  loading={pay.isPending}
                  style={styles.cta}
                  onPress={onPay}
                />
              )}
              <Pressable onPress={close} accessibilityRole="button" style={styles.cancel}>
                <Text variant="caption" weight="semibold" tone="muted">
                  {stage === 'review' ? 'Not now' : 'Pay later'}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function Row({ label, value, muted, bold }: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant="caption" tone={muted ? 'muted' : 'secondary'}>
        {label}
      </Text>
      <Text variant={bold ? 'subheading' : 'caption'} weight={bold ? 'bold' : 'medium'} tone={muted ? 'muted' : 'default'}>
        {value}
      </Text>
    </View>
  );
}

function acceptError(e: ApiError): string {
  const first = (e.details as { acceptance?: string[] } | undefined)?.acceptance?.[0];
  switch (first) {
    case 'BID_NOT_ACTIVE':
      return 'This provider has withdrawn their offer.';
    case 'BID_EXPIRED':
      return 'This offer has expired. Ask the provider to send it again.';
    case 'ALREADY_CONFIRMED':
    case 'JOB_NOT_ACCEPTABLE':
      return 'This booking is already confirmed with another provider.';
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
    maxHeight: '88%',
    backgroundColor: palette.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: palette.border, marginBottom: spacing.md },
  title: { fontSize: 19, lineHeight: 26, color: palette.text },

  providerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  providerText: { flex: 1, gap: 2 },

  breakdown: { marginTop: spacing.lg, backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: spacing.xs },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  assurance: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  cta: { marginTop: spacing.xl },
  cancel: { alignItems: 'center', marginTop: spacing.md, minHeight: 40, justifyContent: 'center' },

  done: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  doneBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 22, lineHeight: 28, color: palette.text },
});
